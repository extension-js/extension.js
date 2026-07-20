import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {BoringPlugin} from '../boring'

type DoneTap = (stats: unknown) => void

function makeCompiler() {
  let doneTap: DoneTap | undefined
  const compiler = {
    hooks: {
      watchClose: {tap: vi.fn()},
      done: {
        tap: (_name: string, fn: DoneTap) => {
          doneTap = fn
        }
      }
    },
    modifiedFiles: new Set<string>(),
    options: {context: '/project'}
  }
  return {compiler, getDoneTap: () => doneTap!}
}

function makeStats({hasErrors = false} = {}) {
  return {
    hasErrors: () => hasErrors,
    hasWarnings: () => false,
    compilation: {
      name: undefined as string | undefined,
      startTime: 1000,
      endTime: 1042,
      modifiedFiles: new Set<string>()
    }
  }
}

describe('BoringPlugin done tap vs invalid manifest JSON', () => {
  const previousLaunchEnv = process.env.EXTENSION_BROWSER_LAUNCH_ENABLED
  let tmpDir: string
  let manifestPath: string
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    process.env.EXTENSION_BROWSER_LAUNCH_ENABLED = '0'
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boring-spec-'))
    manifestPath = path.join(tmpDir, 'manifest.json')
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    logSpy.mockRestore()
    fs.rmSync(tmpDir, {recursive: true, force: true})
    if (previousLaunchEnv === undefined)
      delete process.env.EXTENSION_BROWSER_LAUNCH_ENABLED
    else process.env.EXTENSION_BROWSER_LAUNCH_ENABLED = previousLaunchEnv
  })

  it('does not throw when the manifest on disk is invalid JSON', () => {
    fs.writeFileSync(manifestPath, '{ "manifest_version": 3, "name": "Trunc')
    const {compiler, getDoneTap} = makeCompiler()
    new BoringPlugin({manifestPath, browser: 'chromium'}).apply(
      compiler as never
    )

    expect(() => getDoneTap()(makeStats({hasErrors: true}))).not.toThrow()
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(String(logSpy.mock.calls[0][0])).toContain('Extension')
  })

  it('falls back to the last successfully parsed name mid-save', () => {
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({manifest_version: 3, name: 'My App', version: '1.0.0'})
    )
    const {compiler, getDoneTap} = makeCompiler()
    new BoringPlugin({manifestPath, browser: 'chromium'}).apply(
      compiler as never
    )

    getDoneTap()(makeStats())
    expect(String(logSpy.mock.calls[0][0])).toContain('My App')

    fs.writeFileSync(manifestPath, '{ "name": "My App, "version"')
    expect(() => getDoneTap()(makeStats({hasErrors: true}))).not.toThrow()
    expect(String(logSpy.mock.calls[1][0])).toContain('My App')
  })
})
