import {beforeEach, describe, expect, it, vi} from 'vitest'
import {setOriginalManifestContent} from '../manifest-lib/manifest'
import {UpdateManifest} from '../steps/update-manifest'

const overridesSpy = vi.hoisted(() => vi.fn(() => JSON.stringify({icons: {}})))

vi.mock('../../lib/utils', () => ({
  getManifestContent: (_c: any, _p: string) => ({
    name: 'x',
    content_scripts: [{js: [], css: ['a.css']}]
  }),
  getFilename: (n: string) => `${n}`
}))

vi.mock('../manifest-overrides', () => ({
  getManifestOverrides: overridesSpy
}))

describe('UpdateManifest', () => {
  beforeEach(() => {
    overridesSpy.mockClear()
  })

  const make = (
    mode: 'development' | 'production',
    manifestSource = '{"name":"x"}',
    extraAssets: string[] = []
  ) => {
    const assets: Record<string, any> = {
      'manifest.json': {source: () => manifestSource}
    }

    for (const name of extraAssets) {
      assets[name] = {source: () => ''}
    }

    const updated: Record<string, string> = {}
    const compilation: any = {
      errors: [],
      warnings: [],
      options: {mode},
      assets,
      getAsset: (n: string) =>
        assets[n] ? {source: assets[n].source} : undefined,
      getAssets: () =>
        Object.entries(assets).map(([name, src]) => ({name, source: src})),
      hooks: {
        processAssets: {tap: (_opts: any, fn: any) => fn()}
      },
      updateAsset: (name: string, src: any) =>
        (updated[name] = src.source().toString())
    }
    const compiler: any = {
      options: {mode},
      hooks: {
        thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}
      }
    }

    return {compiler, updated, compilation}
  }

  it('applies overrides and dev content_scripts overrides in development', () => {
    const {compiler, updated} = make(
      'development',
      JSON.stringify({
        name: 'x',
        content_scripts: [{matches: ['*://*/*'], css: ['a.css']}]
      })
    )
    new UpdateManifest({manifestPath: '/m'} as any).apply(compiler)
    const out = JSON.parse(updated['manifest.json'])
    expect(out.icons).toBeDefined()
    expect(out.content_scripts?.[0]?.js).toEqual([
      'content_scripts/content-0.js'
    ])
  })

  it('resolves the css-only dev stub to the hashed emitted asset', () => {
    const {compiler, updated} = make(
      'development',
      JSON.stringify({
        name: 'x',
        content_scripts: [{matches: ['*://*/*'], css: ['a.css']}]
      }),
      ['content_scripts/content-0.deadbeef.js']
    )
    new UpdateManifest({manifestPath: '/m'} as any).apply(compiler)
    const out = JSON.parse(updated['manifest.json'])
    expect(out.content_scripts?.[0]?.js).toEqual([
      'content_scripts/content-0.deadbeef.js'
    ])
  })

  it('derives the css-only stub index from the canonical css path, not array position', () => {
    const {compiler, updated} = make(
      'development',
      JSON.stringify({
        name: 'x',
        content_scripts: [
          {matches: ['*://*/*'], js: ['content_scripts/content-0.js']},
          {matches: ['*://*/*'], css: ['content_scripts/content-3.css']}
        ]
      })
    )
    new UpdateManifest({manifestPath: '/m'} as any).apply(compiler)
    const out = JSON.parse(updated['manifest.json'])
    expect(out.content_scripts?.[1]?.js).toEqual([
      'content_scripts/content-3.js'
    ])
  })

  it('updates asset in production as well', () => {
    const {compiler, updated} = make('production')
    new UpdateManifest({manifestPath: '/m'} as any).apply(compiler)
    const out = JSON.parse(updated['manifest.json'])
    expect(out.icons).toBeDefined()
  })

  it('prints the fatal-shape repair when the manifest is patched, before the asset is written', () => {
    const order: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      order.push('print')
    })
    const warnings: any[] = []
    const source = JSON.stringify({name: 'x', version: 1})
    const assets: Record<string, any> = {
      'manifest.json': {source: () => source}
    }
    const compilation: any = {
      errors: [],
      warnings,
      options: {mode: 'production'},
      assets,
      getAsset: (n: string) =>
        assets[n] ? {source: assets[n].source} : undefined,
      getAssets: () =>
        Object.entries(assets).map(([name, src]) => ({name, source: src})),
      hooks: {
        processAssets: {tap: (_opts: any, fn: any) => fn()}
      },
      updateAsset: () => {
        order.push('asset')
      }
    }
    const compiler: any = {
      options: {mode: 'production'},
      hooks: {
        thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}
      }
    }

    new UpdateManifest({manifestPath: '/m'} as any).apply(compiler)

    expect(warnings.length).toBe(1)
    expect(warnings[0].name).toBe('ManifestFatalShapeWarning')
    expect(logSpy.mock.calls.map((call) => call[0])).toEqual([
      warnings[0].message
    ])

    expect(order).toEqual(['print', 'asset'])

    logSpy.mockRestore()
  })

  it('prints a repeated fatal-shape repair only once per development session', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    let thisCompilationFn: ((compilation: any) => void) | undefined
    const compiler: any = {
      options: {mode: 'development'},
      hooks: {
        thisCompilation: {
          tap: (_n: string, fn: any) => {
            thisCompilationFn = fn
          }
        }
      }
    }

    new UpdateManifest({manifestPath: '/m'} as any).apply(compiler)

    const runCompilation = () => {
      const warnings: any[] = []
      const updated: Record<string, string> = {}
      const source = JSON.stringify({name: 'x', version: 1})
      const assets: Record<string, any> = {
        'manifest.json': {source: () => source}
      }
      const compilation: any = {
        errors: [],
        warnings,
        options: {mode: 'development'},
        assets,
        getAsset: (n: string) =>
          assets[n] ? {source: assets[n].source} : undefined,
        getAssets: () =>
          Object.entries(assets).map(([name, src]) => ({name, source: src})),
        hooks: {
          processAssets: {tap: (_opts: any, fn: any) => fn()}
        },
        updateAsset: (name: string, src: any) => {
          updated[name] = src.source().toString()
        }
      }
      thisCompilationFn?.(compilation)

      return {warnings, updated}
    }

    const first = runCompilation()
    expect(first.warnings.length).toBe(1)
    expect(first.warnings[0].name).toBe('ManifestFatalShapeWarning')
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(first.updated['manifest.json']).version).toBe('1')

    const second = runCompilation()
    // Same repair still applied, but the human line and stats record stay quiet.
    expect(second.warnings.length).toBe(0)
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(second.updated['manifest.json']).version).toBe('1')

    logSpy.mockRestore()
  })

  it('still prints every fatal-shape repair on production builds', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    let thisCompilationFn: ((compilation: any) => void) | undefined
    const compiler: any = {
      options: {mode: 'production'},
      hooks: {
        thisCompilation: {
          tap: (_n: string, fn: any) => {
            thisCompilationFn = fn
          }
        }
      }
    }

    new UpdateManifest({manifestPath: '/m'} as any).apply(compiler)

    const runCompilation = () => {
      const warnings: any[] = []
      const source = JSON.stringify({name: 'x', version: 1})
      const assets: Record<string, any> = {
        'manifest.json': {source: () => source}
      }
      const compilation: any = {
        errors: [],
        warnings,
        options: {mode: 'production'},
        assets,
        getAsset: (n: string) =>
          assets[n] ? {source: assets[n].source} : undefined,
        getAssets: () =>
          Object.entries(assets).map(([name, src]) => ({name, source: src})),
        hooks: {
          processAssets: {tap: (_opts: any, fn: any) => fn()}
        },
        updateAsset: () => {}
      }
      thisCompilationFn?.(compilation)

      return warnings
    }

    expect(runCompilation().length).toBe(1)
    expect(runCompilation().length).toBe(1)
    expect(logSpy).toHaveBeenCalledTimes(2)

    logSpy.mockRestore()
  })

  it('names the MV3 string content_security_policy it rewrote', () => {
    const {compiler, compilation} = make(
      'production',
      JSON.stringify({
        name: 'x',
        manifest_version: 3,
        content_security_policy: "script-src 'self'; object-src 'self'"
      })
    )
    new UpdateManifest({manifestPath: '/m'} as any).apply(compiler)
    const named = compilation.warnings.filter((warning: any) =>
      String(warning.message).includes('content_security_policy')
    )
    expect(named).toHaveLength(1)
    expect(named[0].message).toContain('extension_pages')
  })

  it('folds an MV3 browser_action into action and names the rewrite', () => {
    const {compiler, updated, compilation} = make(
      'production',
      JSON.stringify({
        name: 'x',
        manifest_version: 3,
        browser_action: {default_popup: 'popup.html'}
      })
    )
    new UpdateManifest({manifestPath: '/m'} as any).apply(compiler)
    const out = JSON.parse(updated['manifest.json'])
    expect(out.browser_action).toBeUndefined()
    expect(out.action).toEqual({default_popup: 'popup.html'})
    expect(
      compilation.warnings.filter((warning: any) =>
        String(warning.message).includes('browser_action')
      )
    ).toHaveLength(1)
  })

  it('refuses an MV3 background.page on chromium by name', () => {
    const {compiler, compilation} = make(
      'production',
      JSON.stringify({
        name: 'x',
        manifest_version: 3,
        background: {page: 'background.html'}
      })
    )
    new UpdateManifest({manifestPath: '/m', browser: 'chrome'} as any).apply(
      compiler
    )

    expect(compilation.errors).toHaveLength(1)
    expect(compilation.errors[0].message).toContain('background.page')
  })

  it('keeps an MV3 background.page for firefox', () => {
    const {compiler, compilation} = make(
      'production',
      JSON.stringify({
        name: 'x',
        manifest_version: 3,
        background: {page: 'background.html'}
      })
    )
    new UpdateManifest({manifestPath: '/m', browser: 'firefox'} as any).apply(
      compiler
    )

    expect(compilation.errors).toHaveLength(0)
  })

  it('computes the override tree once per compile', () => {
    const {compiler} = make('development', JSON.stringify({name: 'x'}))
    new UpdateManifest({manifestPath: '/m'} as any).apply(compiler)
    expect(overridesSpy).toHaveBeenCalledTimes(1)
  })

  it('emits manifest.json when no public asset exists yet', () => {
    const emitted: Record<string, string> = {}
    const compilation: any = {
      errors: [],
      warnings: [],
      assets: {},
      getAsset: () => undefined,
      hooks: {
        processAssets: {tap: (_opts: any, fn: any) => fn()}
      },
      updateAsset: vi.fn(),
      emitAsset: (name: string, src: any) => {
        emitted[name] = src.source().toString()
      }
    }
    const compiler: any = {
      options: {mode: 'production'},
      hooks: {
        thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}
      }
    }
    setOriginalManifestContent(
      compilation,
      JSON.stringify({name: 'x', content_scripts: [{js: [], css: ['a.css']}]})
    )

    new UpdateManifest({manifestPath: '/m'} as any).apply(compiler)

    expect(compilation.updateAsset).not.toHaveBeenCalled()
    expect(JSON.parse(emitted['manifest.json']).icons).toBeDefined()
  })
})
