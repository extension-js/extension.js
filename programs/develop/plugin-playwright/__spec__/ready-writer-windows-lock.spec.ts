import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const lock = vi.hoisted(() => ({remaining: 0, readyCalls: 0}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()

  return {
    ...actual,
    renameSync(from: fs.PathLike, to: fs.PathLike) {
      if (String(to).endsWith('ready.json')) {
        lock.readyCalls += 1

        if (lock.remaining > 0) {
          lock.remaining -= 1

          throw Object.assign(new Error('EPERM: operation not permitted'), {
            code: 'EPERM'
          })
        }
      }

      return actual.renameSync(from, to)
    }
  }
})

const {createPlaywrightMetadataWriter} = await import('../index')

describe('ready.json writer while a Windows reader holds the file', () => {
  const realPlatform = process.platform
  let tmp: string

  beforeEach(() => {
    Object.defineProperty(process, 'platform', {value: 'win32'})
    lock.remaining = 0
    lock.readyCalls = 0
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-writer-lock-'))
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', {value: realPlatform})
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const makeWriter = () =>
    createPlaywrightMetadataWriter({
      packageJsonDir: tmp,
      browser: 'chromium',
      command: 'dev',
      distPath: path.join(tmp, 'dist', 'chromium'),
      manifestPath: path.join(tmp, 'src', 'manifest.json')
    })

  it('lands the ready stamp once the reader releases the file', () => {
    const writer = makeWriter()
    lock.remaining = 2

    writer.writeReady()

    expect(lock.readyCalls).toBe(3)
    expect(JSON.parse(fs.readFileSync(writer.readyPath, 'utf-8')).status).toBe(
      'ready'
    )

    expect(
      fs
        .readdirSync(path.dirname(writer.readyPath))
        .filter((name) => name.includes('.tmp-'))
    ).toEqual([])
  })

  it('leaves no temp file and does not throw when the lock never clears', () => {
    const writer = makeWriter()
    lock.remaining = 100

    expect(() => writer.writeReady()).not.toThrow()

    expect(lock.readyCalls).toBe(7)
    expect(
      fs
        .readdirSync(path.dirname(writer.readyPath))
        .filter((name) => name.includes('.tmp-'))
    ).toEqual([])
  })
})
