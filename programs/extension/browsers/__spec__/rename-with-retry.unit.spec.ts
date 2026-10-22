import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {renameSyncWithRetry} from '../browsers-lib/rename-with-retry'

function failing(codes: string[]) {
  const calls: Array<[string, string]> = []
  const queue = [...codes]

  return {
    calls,
    rename(from: string, to: string) {
      calls.push([from, to])
      const code = queue.shift()

      if (code) {
        throw Object.assign(new Error(`${code}: rename ${from} -> ${to}`), {
          code
        })
      }
    }
  }
}

describe('renameSyncWithRetry', () => {
  it('retries a Windows lock and lands once the reader lets go', () => {
    const fake = failing(['EPERM', 'EPERM'])
    const sleeps: number[] = []

    renameSyncWithRetry('a.tmp', 'a', {
      platform: 'win32',
      rename: fake.rename,
      sleep: (ms) => sleeps.push(ms)
    })

    expect(fake.calls).toHaveLength(3)
    expect(sleeps).toEqual([10, 20])
  })

  it.each(['EACCES', 'EBUSY'])('retries %s on Windows', (code) => {
    const fake = failing([code])

    renameSyncWithRetry('a.tmp', 'a', {
      platform: 'win32',
      rename: fake.rename,
      sleep: () => {}
    })

    expect(fake.calls).toHaveLength(2)
  })

  it('gives up with the original error when the lock never clears', () => {
    const fake = failing(Array(20).fill('EPERM'))
    const sleeps: number[] = []

    expect(() =>
      renameSyncWithRetry('a.tmp', 'a', {
        platform: 'win32',
        rename: fake.rename,
        sleep: (ms) => sleeps.push(ms)
      })
    ).toThrow(expect.objectContaining({code: 'EPERM'}))

    expect(fake.calls).toHaveLength(7)
    expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBeLessThan(1000)
  })

  it('does not retry outside Windows', () => {
    const fake = failing(['EPERM'])
    const sleeps: number[] = []

    expect(() =>
      renameSyncWithRetry('a.tmp', 'a', {
        platform: 'linux',
        rename: fake.rename,
        sleep: (ms) => sleeps.push(ms)
      })
    ).toThrow(expect.objectContaining({code: 'EPERM'}))

    expect(fake.calls).toHaveLength(1)
    expect(sleeps).toEqual([])
  })

  it('does not retry an error a lock cannot cause', () => {
    const fake = failing(['ENOENT'])

    expect(() =>
      renameSyncWithRetry('a.tmp', 'a', {
        platform: 'win32',
        rename: fake.rename,
        sleep: () => {}
      })
    ).toThrow(expect.objectContaining({code: 'ENOENT'}))

    expect(fake.calls).toHaveLength(1)
  })

  it('renames a real file with the default options', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-retry-'))

    try {
      fs.writeFileSync(path.join(tmp, 'a.tmp'), 'x')
      renameSyncWithRetry(path.join(tmp, 'a.tmp'), path.join(tmp, 'a'))

      expect(fs.readdirSync(tmp)).toEqual(['a'])
    } finally {
      fs.rmSync(tmp, {recursive: true, force: true})
    }
  })
})
