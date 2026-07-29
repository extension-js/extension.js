import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {BoringPlugin} from '../boring'

type DoneTap = (stats: unknown) => void

function makeCompiler(tmpDir: string) {
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
    options: {context: tmpDir}
  }
  return {compiler, done: (stats: unknown) => doneTap?.(stats)}
}

function successStats(modifiedFiles: string[] = []) {
  return {
    hasErrors: () => false,
    hasWarnings: () => false,
    compilation: {
      name: undefined,
      startTime: 1000,
      endTime: 1512,
      modifiedFiles: new Set(modifiedFiles)
    }
  }
}

describe('BoringPlugin startup line', () => {
  const previousLaunchEnv = process.env.EXTENSION_BROWSER_LAUNCH_ENABLED
  const previousBannerEnv = process.env.EXTENSION_CLI_BANNER_PRINTED
  let logSpy: ReturnType<typeof vi.spyOn>
  let tmpDir: string

  beforeEach(() => {
    process.env.EXTENSION_BROWSER_LAUNCH_ENABLED = '1'
    delete process.env.EXTENSION_CLI_BANNER_PRINTED
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boring-first-line-'))
    fs.writeFileSync(
      path.join(tmpDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Boring App',
        version: '1.0.0'
      })
    )
  })

  afterEach(() => {
    logSpy.mockRestore()
    fs.rmSync(tmpDir, {recursive: true, force: true})
    if (previousLaunchEnv === undefined)
      delete process.env.EXTENSION_BROWSER_LAUNCH_ENABLED
    else process.env.EXTENSION_BROWSER_LAUNCH_ENABLED = previousLaunchEnv
    if (previousBannerEnv === undefined)
      delete process.env.EXTENSION_CLI_BANNER_PRINTED
    else process.env.EXTENSION_CLI_BANNER_PRINTED = previousBannerEnv
  })

  it('prints the first success immediately, before any card is printed', () => {
    const {compiler, done} = makeCompiler(tmpDir)
    new BoringPlugin({
      manifestPath: path.join(tmpDir, 'manifest.json'),
      browser: 'chromium'
    }).apply(compiler as never)

    done(successStats())

    expect(logSpy).toHaveBeenCalledTimes(1)
    const line = String(logSpy.mock.calls[0][0])
    expect(line).toContain('Boring App')
    expect(line).toContain('compiled in 512 ms.')
    expect(line).not.toContain('successfully')
  })

  it('suppresses repeated startup successes before the first user change', () => {
    const {compiler, done} = makeCompiler(tmpDir)
    new BoringPlugin({
      manifestPath: path.join(tmpDir, 'manifest.json'),
      browser: 'chromium'
    }).apply(compiler as never)

    done(successStats())
    done(successStats())
    done(successStats())

    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it('prints again after a user file change', () => {
    const {compiler, done} = makeCompiler(tmpDir)
    new BoringPlugin({
      manifestPath: path.join(tmpDir, 'manifest.json'),
      browser: 'chromium'
    }).apply(compiler as never)

    done(successStats())
    done(successStats([path.join(tmpDir, 'content.js')]))

    expect(logSpy).toHaveBeenCalledTimes(2)
  })
})
