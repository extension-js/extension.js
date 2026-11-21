import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {BoringPlugin} from '../boring'

type DoneTap = (stats: unknown) => void

function makeCompiler(tmpDir: string, outputPath?: string) {
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
    options: {
      context: tmpDir,
      output: outputPath ? {path: outputPath} : {}
    }
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

function warningStats(modifiedFiles: string[] = []) {
  return {
    ...successStats(modifiedFiles),
    hasWarnings: () => true
  }
}

describe('BoringPlugin startup line', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let tmpDir: string

  beforeEach(() => {
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
    vi.unstubAllEnvs()
    logSpy.mockRestore()
    fs.rmSync(tmpDir, {recursive: true, force: true})
  })

  it('prints the line of a compile whose changed files cannot be read', () => {
    const {compiler, done} = makeCompiler(tmpDir)
    new BoringPlugin({
      manifestPath: path.join(tmpDir, 'manifest.json')
    }).apply(compiler as never)

    const stats = successStats()
    Object.defineProperty(stats.compilation, 'modifiedFiles', {
      get() {
        throw new Error('the watcher is gone')
      }
    })

    done(stats)

    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(String(logSpy.mock.calls[0][0])).toContain('Boring App')
  })

  it('prints the first success immediately, before any card is printed', () => {
    const {compiler, done} = makeCompiler(tmpDir)
    new BoringPlugin({
      manifestPath: path.join(tmpDir, 'manifest.json'),
      browser: 'chromium',
      browserLaunchEnabled: true
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
      browser: 'chromium',
      browserLaunchEnabled: true
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
      browser: 'chromium',
      browserLaunchEnabled: true
    }).apply(compiler as never)

    done(successStats())
    done(successStats([path.join(tmpDir, 'content.js')]))

    expect(logSpy).toHaveBeenCalledTimes(2)
  })

  it('treats a source path containing a dist segment as a user change', () => {
    const {compiler, done} = makeCompiler(tmpDir)
    new BoringPlugin({
      manifestPath: path.join(tmpDir, 'manifest.json'),
      browser: 'chromium',
      browserLaunchEnabled: true
    }).apply(compiler as never)

    done(successStats())
    // Only <output.path> and <context>/dist are generated roots; a source
    // dir that merely contains a dist segment stays a user change.
    done(successStats([path.join(tmpDir, 'src', 'dist', 'data.json')]))

    expect(logSpy).toHaveBeenCalledTimes(2)
  })

  it('keeps files under the compiler output path classified as generated', () => {
    const {compiler, done} = makeCompiler(tmpDir, path.join(tmpDir, 'out'))
    new BoringPlugin({
      manifestPath: path.join(tmpDir, 'manifest.json'),
      browser: 'chromium',
      browserLaunchEnabled: true
    }).apply(compiler as never)

    done(successStats())
    done(successStats([path.join(tmpDir, 'out', 'main.js')]))
    done(successStats([path.join(tmpDir, 'dist', 'chrome', 'main.js')]))

    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it('still prints the startup success after a warning-bearing first pass', () => {
    const {compiler, done} = makeCompiler(tmpDir)
    new BoringPlugin({
      manifestPath: path.join(tmpDir, 'manifest.json'),
      browser: 'chromium',
      browserLaunchEnabled: true
    }).apply(compiler as never)

    done(warningStats())
    done(warningStats())
    done(successStats())
    done(successStats())

    // One warning line, one success line, duplicates of each suppressed.
    expect(logSpy).toHaveBeenCalledTimes(2)
    expect(String(logSpy.mock.calls[0][0])).toContain('with 1 warning')
    expect(String(logSpy.mock.calls[1][0])).toContain('compiled in')
  })

  it('prints every startup pass when no browser is launched', () => {
    const {compiler, done} = makeCompiler(tmpDir)
    new BoringPlugin({
      manifestPath: path.join(tmpDir, 'manifest.json'),
      browser: 'chromium',
      browserLaunchEnabled: false
    }).apply(compiler as never)

    done(successStats())
    done(successStats())
    done(successStats())

    expect(logSpy).toHaveBeenCalledTimes(3)
  })

  // A flag another session left in the process is not this compile's setting.
  it('prints one startup line with the option unset, whatever the environment says', () => {
    vi.stubEnv('EXTENSION_BROWSER_LAUNCH_ENABLED', '0')

    const {compiler, done} = makeCompiler(tmpDir)
    new BoringPlugin({
      manifestPath: path.join(tmpDir, 'manifest.json'),
      browser: 'chromium'
    }).apply(compiler as never)

    done(successStats())
    done(successStats())
    expect(logSpy).toHaveBeenCalledTimes(1)
  })
})
