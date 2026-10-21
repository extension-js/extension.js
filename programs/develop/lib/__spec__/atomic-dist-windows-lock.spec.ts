import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const lock = vi.hoisted(() => ({target: '', remaining: 0, calls: 0}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()

  return {
    ...actual,
    renameSync(from: fs.PathLike, to: fs.PathLike) {
      if (String(to) === lock.target) {
        lock.calls += 1

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

const {promoteStagingDist} = await import('../atomic-dist')

describe('promoteStagingDist while Windows holds the dist open', () => {
  const realPlatform = process.platform
  let tmp: string
  let distPath: string
  let stagingPath: string

  beforeEach(() => {
    Object.defineProperty(process, 'platform', {value: 'win32'})
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-dist-lock-'))
    distPath = path.join(tmp, 'dist', 'chromium')
    stagingPath = path.join(tmp, 'dist', '.extension-build-chromium')
    fs.mkdirSync(distPath, {recursive: true})
    fs.writeFileSync(path.join(distPath, 'manifest.json'), '{"v":1}')
    fs.mkdirSync(stagingPath, {recursive: true})
    fs.writeFileSync(path.join(stagingPath, 'manifest.json'), '{"v":2}')
    lock.calls = 0
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', {value: realPlatform})
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('promotes the new build once the lock on the dist clears', () => {
    lock.target = distPath
    lock.remaining = 2

    promoteStagingDist(stagingPath, distPath)

    expect(lock.calls).toBe(3)
    expect(fs.readFileSync(path.join(distPath, 'manifest.json'), 'utf-8')).toBe(
      '{"v":2}'
    )

    expect(fs.existsSync(stagingPath)).toBe(false)
  })

  it('retires the previous build once the lock on it clears', () => {
    lock.target = `${stagingPath}-retired`
    lock.remaining = 2

    promoteStagingDist(stagingPath, distPath)

    expect(lock.calls).toBe(3)
    expect(fs.readFileSync(path.join(distPath, 'manifest.json'), 'utf-8')).toBe(
      '{"v":2}'
    )
  })
})
