import {Compilation} from '@rspack/core'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {setOriginalManifestContent} from '../manifest-lib/manifest'
import * as messages from '../messages'
import {ManifestLegacyWarnings} from '../steps/legacy-warnings'

function makeCompiler(mode: 'development' | 'production' = 'development') {
  let thisCompilationFn: ((compilation: any) => void) | undefined
  let tapStage: number | undefined

  const compiler: any = {
    options: {mode},
    hooks: {
      thisCompilation: {
        tap: (_n: string, fn: any) => {
          thisCompilationFn = fn
        }
      }
    }
  }

  const runCompilation = (manifestSource: string) => {
    const warnings: any[] = []
    let processAssetsFn: (() => void) | undefined
    const compilation: any = {
      warnings,
      hooks: {
        processAssets: {
          tap: (opts: any, cb: any) => {
            tapStage = opts.stage
            processAssetsFn = cb
          }
        }
      },
      getAsset: () => undefined
    }
    setOriginalManifestContent(compilation, manifestSource)
    thisCompilationFn?.(compilation)
    processAssetsFn?.()
    return warnings
  }

  return {
    compiler,
    runCompilation,
    getTapStage: () => tapStage
  }
}

describe('ManifestLegacyWarnings', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints field, path, and modern destination from the author manifest', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {compiler, runCompilation, getTapStage} = makeCompiler('development')

    new ManifestLegacyWarnings().apply(compiler)

    const warnings = runCompilation(
      JSON.stringify({
        name: 'x',
        options_ui: {page: 'options_ui/page.html'}
      })
    )

    const expected = messages.legacyManifestPathWarning(
      'options_ui.page',
      'options_ui/page.html',
      'options/index.html'
    )
    expect(logSpy.mock.calls.map((call) => call[0])).toEqual([expected])
    expect(warnings.length).toBe(1)
    expect(warnings[0].message).toBe(expected)
    expect(warnings[0].name).toBe('ManifestLegacyWarning')
    expect(warnings[0].file).toBe('manifest.json')
    expect(getTapStage()).toBe(Compilation.PROCESS_ASSETS_STAGE_REPORT)
  })

  it('warns for every old-layout field in one pass', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {compiler, runCompilation} = makeCompiler('development')

    new ManifestLegacyWarnings().apply(compiler)

    const warnings = runCompilation(
      JSON.stringify({
        options_ui: {page: 'options_ui/page.html'},
        devtools_page: 'devtools_page/devtools_page.html',
        background: {page: 'background/page.html'}
      })
    )

    expect(warnings.length).toBe(3)
    expect(logSpy).toHaveBeenCalledTimes(3)
    expect(warnings.map((w) => w.message)).toEqual([
      messages.legacyManifestPathWarning(
        'devtools_page',
        'devtools_page/devtools_page.html',
        'devtools/index.html'
      ),
      messages.legacyManifestPathWarning(
        'options_ui.page',
        'options_ui/page.html',
        'options/index.html'
      ),
      messages.legacyManifestPathWarning(
        'background.page',
        'background/page.html',
        'background/index.html'
      )
    ])
  })

  it('does not fire when only the rewritten asset still looks modern', () => {
    // Regression: the old implementation scanned the post-rewrite asset via
    // text.includes, so it never saw author paths after UpdateManifest ran.
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {compiler, runCompilation} = makeCompiler('development')

    new ManifestLegacyWarnings().apply(compiler)

    // Author still on the old scaffold; original content is what we scan.
    const warnings = runCompilation(
      JSON.stringify({
        options_ui: {page: 'options_ui/page.html'}
      })
    )

    expect(warnings.length).toBe(1)
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it('ignores old path strings that only appear outside their entrypoint field', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {compiler, runCompilation} = makeCompiler('development')

    new ManifestLegacyWarnings().apply(compiler)

    const warnings = runCompilation(
      JSON.stringify({
        description: 'mentions options_ui/page.html',
        web_accessible_resources: [
          {resources: ['options_ui/page.html'], matches: ['<all_urls>']}
        ],
        options_ui: {page: 'options/index.html'}
      })
    )

    expect(logSpy).not.toHaveBeenCalled()
    expect(warnings.length).toBe(0)
  })

  it('prints a repeated legacy path only once per development session', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {compiler, runCompilation} = makeCompiler('development')

    new ManifestLegacyWarnings().apply(compiler)

    const source = JSON.stringify({
      options_ui: {page: 'options_ui/page.html'}
    })

    expect(runCompilation(source).length).toBe(1)
    expect(logSpy).toHaveBeenCalledTimes(1)

    // Same repair on a later save: silent, but a new field still prints.
    expect(runCompilation(source).length).toBe(0)
    expect(logSpy).toHaveBeenCalledTimes(1)

    const withDevtools = JSON.stringify({
      options_ui: {page: 'options_ui/page.html'},
      devtools_page: 'devtools_page/devtools_page.html'
    })
    const third = runCompilation(withDevtools)
    expect(third.length).toBe(1)
    expect(third[0].message).toBe(
      messages.legacyManifestPathWarning(
        'devtools_page',
        'devtools_page/devtools_page.html',
        'devtools/index.html'
      )
    )
    expect(logSpy).toHaveBeenCalledTimes(2)
  })

  it('still prints every legacy path on production builds', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {compiler, runCompilation} = makeCompiler('production')

    new ManifestLegacyWarnings().apply(compiler)

    const source = JSON.stringify({
      options_ui: {page: 'options_ui/page.html'}
    })

    expect(runCompilation(source).length).toBe(1)
    expect(runCompilation(source).length).toBe(1)
    expect(logSpy).toHaveBeenCalledTimes(2)
  })

  it('prints and records nothing when no legacy path exists', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {compiler, runCompilation} = makeCompiler('development')

    new ManifestLegacyWarnings().apply(compiler)

    const warnings = runCompilation(
      JSON.stringify({
        name: 'x',
        action: {default_popup: 'action/default_popup.html'},
        options_ui: {page: 'options/index.html'}
      })
    )

    expect(logSpy).not.toHaveBeenCalled()
    expect(warnings.length).toBe(0)
  })
})
