import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

async function freshSharedState() {
  vi.resetModules()
  return await import('../compilation-lib/shared-state')
}

describe('shared-state banner bridge', () => {
  const previousEnv = process.env.EXTENSION_CLI_BANNER_PRINTED
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    delete process.env.EXTENSION_CLI_BANNER_PRINTED
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    logSpy.mockRestore()
    if (previousEnv === undefined)
      delete process.env.EXTENSION_CLI_BANNER_PRINTED
    else process.env.EXTENSION_CLI_BANNER_PRINTED = previousEnv
  })

  it('flushes the pending line when the env flag is converted', async () => {
    const {setPendingCompilationLine, isBannerPrinted, sharedState} =
      await freshSharedState()

    setPendingCompilationLine('  ⏵⏵⏵ deferred compile #1')
    expect(isBannerPrinted()).toBe(false)
    expect(logSpy).not.toHaveBeenCalled()

    process.env.EXTENSION_CLI_BANNER_PRINTED = 'true'

    expect(isBannerPrinted()).toBe(true)
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('  ⏵⏵⏵ deferred compile #1')
    expect(sharedState.bannerPrinted).toBe(true)
    expect(sharedState.pendingCompilationLine).toBe('')
  })

  it('reports printed without parking when the flag is already set', async () => {
    const {isBannerPrinted, sharedState} = await freshSharedState()

    process.env.EXTENSION_CLI_BANNER_PRINTED = 'true'

    expect(isBannerPrinted()).toBe(true)
    expect(sharedState.pendingCompilationLine).toBe('')
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('does not double-print on repeated conversions', async () => {
    const {setPendingCompilationLine, isBannerPrinted} =
      await freshSharedState()

    setPendingCompilationLine('  ⏵⏵⏵ deferred compile #1')
    process.env.EXTENSION_CLI_BANNER_PRINTED = 'true'
    isBannerPrinted()
    isBannerPrinted()

    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  // The launched path parks the line at done and the launcher sets the flag
  // later in the same cycle; afterDone is what flushes it without a rebuild.
  it('flushes the parked line at afterDone once the launcher set the flag', async () => {
    vi.resetModules()
    const {BoringPlugin} = await import('../boring')

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'banner-bridge-'))
    const manifestPath = path.join(tmpDir, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({manifest_version: 3, name: 'Flush App', version: '1.0.0'})
    )

    const previousLaunchEnv = process.env.EXTENSION_BROWSER_LAUNCH_ENABLED
    process.env.EXTENSION_BROWSER_LAUNCH_ENABLED = '1'

    try {
      let doneTap: ((stats: unknown) => void) | undefined
      let afterDoneTap: (() => void) | undefined
      const compiler = {
        hooks: {
          watchClose: {tap: vi.fn()},
          done: {
            tap: (_name: string, fn: (stats: unknown) => void) => {
              doneTap = fn
            }
          },
          afterDone: {
            tap: (_name: string, fn: () => void) => {
              afterDoneTap = fn
            }
          }
        },
        modifiedFiles: new Set<string>(),
        options: {context: tmpDir}
      }

      new BoringPlugin({manifestPath, browser: 'chromium'}).apply(
        compiler as never
      )

      doneTap?.({
        hasErrors: () => false,
        hasWarnings: () => false,
        compilation: {
          name: undefined,
          startTime: 1000,
          endTime: 1042,
          modifiedFiles: new Set<string>()
        }
      })
      expect(logSpy).not.toHaveBeenCalled()

      process.env.EXTENSION_CLI_BANNER_PRINTED = 'true'
      afterDoneTap?.()

      expect(logSpy).toHaveBeenCalledTimes(1)
      expect(String(logSpy.mock.calls[0][0])).toContain('Flush App')
    } finally {
      if (previousLaunchEnv === undefined)
        delete process.env.EXTENSION_BROWSER_LAUNCH_ENABLED
      else process.env.EXTENSION_BROWSER_LAUNCH_ENABLED = previousLaunchEnv
      fs.rmSync(tmpDir, {recursive: true, force: true})
    }
  })
})
