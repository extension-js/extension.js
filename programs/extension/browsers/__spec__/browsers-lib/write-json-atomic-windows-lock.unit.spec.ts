import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {writeJsonAtomic} from '../../browsers-lib/write-json-atomic'

// A reader that holds the file for a number of renames, then lets go.
function lockedFor(renames: number) {
  const lock = {remaining: renames, calls: 0, pauses: [] as number[]}

  return {
    lock,
    retry: {
      platform: 'win32' as const,
      rename(from: string, to: string) {
        lock.calls += 1

        if (lock.remaining > 0) {
          lock.remaining -= 1

          throw Object.assign(new Error('EPERM: operation not permitted'), {
            code: 'EPERM'
          })
        }

        fs.renameSync(from, to)
      },
      sleep: (ms: number) => {
        lock.pauses.push(ms)
      }
    }
  }
}

describe('writeJsonAtomic while a Windows reader holds ready.json', () => {
  let tmp: string
  let file: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'write-json-lock-'))
    file = path.join(tmp, 'ready.json')
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('lands the stamp once the reader releases the file', () => {
    const {lock, retry} = lockedFor(2)

    expect(writeJsonAtomic(file, {status: 'ready'}, retry)).toBe(true)

    expect(lock.calls).toBe(3)
    expect(lock.pauses).toEqual([10, 20])
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({
      status: 'ready'
    })

    expect(fs.readdirSync(tmp)).toEqual(['ready.json'])
  })

  it('reports a handled failure and cleans up when the lock never clears', () => {
    const {lock, retry} = lockedFor(100)

    expect(writeJsonAtomic(file, {status: 'ready'}, retry)).toBe(false)

    expect(lock.calls).toBe(7)
    expect(lock.pauses).toEqual([10, 20, 40, 80, 160, 320])
    expect(fs.readdirSync(tmp)).toEqual([])
  })

  it('gives up at the first refusal off Windows', () => {
    const {lock, retry} = lockedFor(1)

    expect(
      writeJsonAtomic(file, {status: 'ready'}, {...retry, platform: 'linux'})
    ).toBe(false)

    expect(lock.calls).toBe(1)
    expect(lock.pauses).toEqual([])
    expect(fs.readdirSync(tmp)).toEqual([])
  })
})
