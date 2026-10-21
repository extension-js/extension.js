import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const lock = vi.hoisted(() => ({remaining: 0, calls: 0}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()

  return {
    ...actual,
    renameSync(from: fs.PathLike, to: fs.PathLike) {
      lock.calls += 1

      if (lock.remaining > 0) {
        lock.remaining -= 1

        throw Object.assign(new Error('EPERM: operation not permitted'), {
          code: 'EPERM'
        })
      }

      return actual.renameSync(from, to)
    }
  }
})

const {writeJsonAtomic} = await import('../browsers-lib/write-json-atomic')

describe('writeJsonAtomic while a Windows reader holds ready.json', () => {
  const realPlatform = process.platform
  let tmp: string
  let file: string

  beforeEach(() => {
    Object.defineProperty(process, 'platform', {value: 'win32'})
    lock.remaining = 0
    lock.calls = 0
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'write-json-lock-'))
    file = path.join(tmp, 'ready.json')
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', {value: realPlatform})
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('lands the stamp once the reader releases the file', () => {
    lock.remaining = 2

    expect(writeJsonAtomic(file, {status: 'ready'})).toBe(true)

    expect(lock.calls).toBe(3)
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({
      status: 'ready'
    })

    expect(fs.readdirSync(tmp)).toEqual(['ready.json'])
  })

  it('reports a handled failure and cleans up when the lock never clears', () => {
    lock.remaining = 100

    expect(writeJsonAtomic(file, {status: 'ready'})).toBe(false)

    expect(lock.calls).toBe(7)
    expect(fs.readdirSync(tmp)).toEqual([])
  })
})
