import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {extensionBuild} from '../webpack/build'

function withTempDir(fn: (dir: string) => Promise<void> | void) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-json-e2e-'))
  try {
    return Promise.resolve(fn(tmpRoot))
  } finally {
    try {
      fs.rmSync(tmpRoot, {recursive: true, force: true})
    } catch {}
  }
}

describe('E2E: invalid JSON causes build to fail (MV3)', () => {
  const originalVerbose = process.env.EXTENSION_VERBOSE

  beforeEach(() => {
    process.env.EXTENSION_VERBOSE = '1'
  })

  afterEach(() => {
    if (originalVerbose === undefined) delete process.env.EXTENSION_VERBOSE
    else process.env.EXTENSION_VERBOSE = originalVerbose
  })

  it('fails build when DNR ruleset JSON is invalid', async () => {
    const spyErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    await withTempDir(async (dir) => {
      // Minimal MV3 manifest with one DNR ruleset
      const manifest = {
        manifest_version: 3,
        name: 'e2e-invalid-json',
        version: '0.0.0',
        declarative_net_request: {
          rule_resources: [
            {id: 'ruleset_1', enabled: true, path: 'ruleset_1.json'}
          ]
        },
        action: {default_title: 'ext'}
      }

      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf-8'
      )

      // Invalid JSON content
      fs.writeFileSync(
        path.join(dir, 'ruleset_1.json'),
        '{ invalid-json',
        'utf-8'
      )

      await expect(
        extensionBuild(dir, {browser: 'chrome', silent: true})
      ).rejects.toThrow()

      const output = spyErr.mock.calls.map((c) => String(c[0] || '')).join('\n')
      expect(output).toMatch(/Invalid JSON/i)
      expect(output).toMatch(/manifest\.json/i)
    })

    spyErr.mockRestore()
    spyLog.mockRestore()
  })
})
