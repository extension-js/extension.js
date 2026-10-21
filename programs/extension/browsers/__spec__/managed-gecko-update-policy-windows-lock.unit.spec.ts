import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  ensureManagedGeckoUpdatePolicy,
  geckoPolicyFilePath
} from '../run-firefox/firefox-launch/managed-update-policy'

describe('managed Gecko update policy while Windows holds policies.json open', () => {
  const realPlatform = process.platform
  let tmp: string
  let cacheRoot: string
  let binaryPath: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-gecko-policy-lock-'))
    cacheRoot = path.join(tmp, 'browsers')
    binaryPath =
      realPlatform === 'darwin'
        ? path.join(
            cacheRoot,
            'firefox',
            'Firefox.app',
            'Contents',
            'MacOS',
            'firefox'
          )
        : path.join(
            cacheRoot,
            'firefox',
            'core',
            realPlatform === 'win32' ? 'firefox.exe' : 'firefox'
          )

    fs.mkdirSync(path.dirname(binaryPath), {recursive: true})
    fs.writeFileSync(binaryPath, '')
    Object.defineProperty(process, 'platform', {value: 'win32'})
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', {value: realPlatform})
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('writes the policy once the lock on policies.json clears', () => {
    let locks = 2
    let calls = 0
    const lockingFs = {
      existsSync: fs.existsSync,
      readFileSync: fs.readFileSync,
      writeFileSync: fs.writeFileSync,
      mkdirSync: fs.mkdirSync,
      renameSync(from: fs.PathLike, to: fs.PathLike) {
        calls += 1

        if (locks > 0) {
          locks -= 1

          throw Object.assign(new Error('EPERM: operation not permitted'), {
            code: 'EPERM'
          })
        }

        fs.renameSync(from, to)
      }
    } as unknown as Parameters<typeof ensureManagedGeckoUpdatePolicy>[0]['fs']

    const result = ensureManagedGeckoUpdatePolicy({
      binaryPath,
      managedRoots: [cacheRoot],
      platform: realPlatform,
      fs: lockingFs
    })

    expect(result.status).toBe('written')
    expect(calls).toBe(3)
    const policyPath = geckoPolicyFilePath(binaryPath, realPlatform) as string
    expect(JSON.parse(fs.readFileSync(policyPath, 'utf8'))).toEqual({
      policies: {DisableAppUpdate: true}
    })
  })
})
