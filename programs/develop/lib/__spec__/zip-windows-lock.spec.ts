import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {strToU8, zipSync} from 'fflate'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const lock = vi.hoisted(() => ({
  match: (_to: string): boolean => false,
  remaining: 0,
  calls: 0,
  copies: 0
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()

  return {
    ...actual,
    renameSync(from: fs.PathLike, to: fs.PathLike) {
      if (lock.match(String(to))) {
        lock.calls += 1

        if (lock.remaining > 0) {
          lock.remaining -= 1

          throw Object.assign(new Error('EPERM: operation not permitted'), {
            code: 'EPERM'
          })
        }
      }

      return actual.renameSync(from, to)
    },
    cpSync(...args: Parameters<typeof actual.cpSync>) {
      lock.copies += 1

      return actual.cpSync(...args)
    }
  }
})

const {extractLocalZip} = await import('../zip')

describe('extractLocalZip while Windows holds the destination open', () => {
  const realPlatform = process.platform
  let tmp: string
  let zipPath: string
  let target: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-lock-'))
    zipPath = path.join(tmp, 'my-extension.zip')
    target = path.join(tmp, 'out')
    fs.mkdirSync(target)
    fs.writeFileSync(
      zipPath,
      Buffer.from(zipSync({'manifest.json': strToU8('{"name":"x"}')}))
    )

    lock.match = () => false
    lock.remaining = 0
    lock.calls = 0
    lock.copies = 0
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', {value: realPlatform})
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('keeps the session folder across a re-extract once its lock clears', async () => {
    const dest = await extractLocalZip(zipPath, target)
    const profileFile = path.join(dest, 'dist', 'extension-js', 'profile.txt')
    fs.mkdirSync(path.dirname(profileFile), {recursive: true})
    fs.writeFileSync(profileFile, 'kept')

    Object.defineProperty(process, 'platform', {value: 'win32'})
    lock.match = (to) =>
      to.endsWith(path.join('dist', 'extension-js')) &&
      to.includes('.extension-staging-')

    lock.remaining = 2

    await extractLocalZip(zipPath, target)

    expect(lock.calls).toBe(3)
    expect(fs.readFileSync(profileFile, 'utf-8')).toBe('kept')
  })

  it('swaps the staged tree in with a rename once its lock clears', async () => {
    Object.defineProperty(process, 'platform', {value: 'win32'})
    lock.match = (to) => to === path.join(target, 'my-extension')
    lock.remaining = 2

    const dest = await extractLocalZip(zipPath, target)

    expect(lock.calls).toBe(3)
    expect(lock.copies).toBe(0)
    expect(fs.existsSync(path.join(dest, 'manifest.json'))).toBe(true)
  })
})
