import {Compilation} from '@rspack/core'
import {afterEach, describe, expect, it, vi} from 'vitest'
import * as messages from '../messages'
import {ManifestLegacyWarnings} from '../steps/legacy-warnings'

function makeCompiler(manifestSource: string) {
  const warnings: any[] = []
  let run: (() => void) | undefined
  let tapStage: number | undefined
  const compiler: any = {
    options: {mode: 'development'},
    hooks: {
      thisCompilation: {
        tap: (_n: string, fn: any) =>
          fn({
            hooks: {
              processAssets: {
                tap: (opts: any, cb: any) => {
                  tapStage = opts.stage
                  run = cb
                }
              }
            },
            getAsset: () => ({
              source: {source: () => manifestSource}
            }),
            warnings
          })
      }
    }
  }
  return {
    compiler,
    warnings,
    runProcessAssets: () => run?.(),
    getTapStage: () => tapStage
  }
}

describe('ManifestLegacyWarnings', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints the warning and records it when the manifest asset is processed', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {compiler, warnings, runProcessAssets, getTapStage} = makeCompiler(
      '{"name":"x","foo":"bar","background":{"page":"devtools_page/devtools_page.html"}}'
    )

    new ManifestLegacyWarnings().apply(compiler)

    expect(logSpy).not.toHaveBeenCalled()
    expect(warnings.length).toBe(0)

    runProcessAssets()

    const expected = messages.legacyManifestPathWarning(
      'devtools_page/devtools_page.html'
    )
    expect(logSpy.mock.calls.map((call) => call[0])).toEqual([expected])
    expect(warnings.length).toBe(1)
    expect(warnings[0].message).toBe(expected)
    expect(warnings[0].name).toBe('ManifestLegacyWarning')
    expect(getTapStage()).toBe(Compilation.PROCESS_ASSETS_STAGE_REPORT)
  })

  it('prints and records nothing when no legacy path exists', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {compiler, warnings, runProcessAssets} = makeCompiler(
      '{"name":"x","action":{"default_popup":"action/default_popup.html"}}'
    )

    new ManifestLegacyWarnings().apply(compiler)
    runProcessAssets()

    expect(logSpy).not.toHaveBeenCalled()
    expect(warnings.length).toBe(0)
  })
})
