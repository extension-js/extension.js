import {describe, expect, it} from 'vitest'
import {
  ASSET_CATEGORIES,
  BUDGET_BYTES,
  categorizeAsset,
  PerfBudgetsPlugin
} from '../index'

describe('categorizeAsset', () => {
  it('classifies content scripts as content-script regardless of hash', () => {
    expect(categorizeAsset('content_scripts/content-0.js')).toBe(
      'content-script'
    )

    expect(categorizeAsset('content_scripts/content-0.abc12345.js')).toBe(
      'content-script'
    )

    expect(categorizeAsset('content_scripts/styles.deadbeef.css')).toBe(
      'content-script'
    )
  })

  it('classifies MV3 service worker and MV2 background as service-worker', () => {
    expect(categorizeAsset('background/service_worker.js')).toBe(
      'service-worker'
    )

    expect(categorizeAsset('background/scripts.js')).toBe('service-worker')
    expect(categorizeAsset('service_worker.js')).toBe('service-worker')
    expect(categorizeAsset('service-worker.js')).toBe('service-worker')
  })

  it('classifies cold UI surfaces as page', () => {
    for (const dir of [
      'pages',
      'sidebar',
      'options',
      'devtools',
      'sandbox',
      'action',
      'page_action'
    ]) {
      expect(categorizeAsset(`${dir}/index.js`)).toBe('page')
    }
  })

  it('classifies override pages and devtools panels as page', () => {
    expect(categorizeAsset('chrome_url_overrides/newtab.js')).toBe('page')
    expect(categorizeAsset('chrome_url_overrides/newtab.css')).toBe('page')
    expect(categorizeAsset('chrome_url_overrides/history.js')).toBe('page')
    expect(categorizeAsset('chrome_url_overrides/bookmarks.js')).toBe('page')
    expect(categorizeAsset('panel/index.js')).toBe('page')
    expect(categorizeAsset('panel/index.css')).toBe('page')
    expect(categorizeAsset('pages/main.js')).toBe('page')
  })

  it('classifies code under an unknown folder as page when nothing says it was copied', () => {
    expect(categorizeAsset('css/file.css')).toBe('page')
    expect(categorizeAsset('js/file.js')).toBe('page')
  })

  it('classifies a file the public copier shipped as public, whatever its path', () => {
    const copied = {copied: true}

    expect(categorizeAsset('vendor/lib.js', copied)).toBe('public')
    expect(categorizeAsset('css/file.css', copied)).toBe('public')
    expect(categorizeAsset('scripts/tool.js', copied)).toBe('public')
    expect(categorizeAsset('vendor/lib.js', {copied: false})).toBe('page')
    expect(categorizeAsset('vendor/lib.js', {})).toBe('page')
    expect(categorizeAsset('assets/icon.png', copied)).toBe('ignored')
  })

  it('classifies injected special folder scripts as content-script', () => {
    expect(categorizeAsset('scripts/script-one.js')).toBe('content-script')
    expect(categorizeAsset('scripts/nested/tool.js')).toBe('content-script')
    expect(categorizeAsset('user_scripts/api.js')).toBe('content-script')
  })

  it('classifies the chunks every page shares as shared', () => {
    expect(categorizeAsset('shared/framework.js')).toBe('shared')
    expect(categorizeAsset('shared/commons.js')).toBe('shared')
  })

  it('ignores binaries, source maps, hot updates, and unknown locations', () => {
    expect(categorizeAsset('assets/icon.png')).toBe('ignored')
    expect(categorizeAsset('assets/font.woff2')).toBe('ignored')
    expect(categorizeAsset('content_scripts/content-0.js.map')).toBe('ignored')
    expect(categorizeAsset('hot/123.abcdef.js')).toBe('ignored')
    expect(categorizeAsset('manifest.json')).toBe('ignored')
    expect(categorizeAsset('_locales/en/messages.json')).toBe('ignored')
  })

  it('classifies top-level runtime payloads and leftover wasm cores', () => {
    expect(categorizeAsset('03bc89f8e5771202.wasm')).toBe('runtime')
    expect(categorizeAsset('ffmpeg-core.js')).toBe('runtime')
    expect(categorizeAsset('ffmpeg-core.worker.js')).toBe('runtime')
    expect(categorizeAsset('assets/ffmpeg-core.wasm')).toBe('runtime')
  })
})

describe('BUDGET_BYTES', () => {
  it('applies tighter budgets to hot paths than to cold UI pages', () => {
    expect(BUDGET_BYTES['content-script']).toBeLessThan(BUDGET_BYTES.page)
    expect(BUDGET_BYTES['service-worker']).toBeLessThan(BUDGET_BYTES.page)
    expect(BUDGET_BYTES.shared).toBeLessThan(BUDGET_BYTES.page)
    expect(BUDGET_BYTES.runtime).toBe(BUDGET_BYTES.page)
    expect(BUDGET_BYTES.ignored).toBe(Number.POSITIVE_INFINITY)
  })

  it('matches the documented 512/512/1024 KiB targets', () => {
    expect(BUDGET_BYTES['content-script']).toBe(512 * 1024)
    expect(BUDGET_BYTES['service-worker']).toBe(512 * 1024)
    expect(BUDGET_BYTES.page).toBe(1024 * 1024)
  })

  it('budgets the shared chunk, copied public files and the runtime payload', () => {
    expect(BUDGET_BYTES.shared).toBe(512 * 1024)
    expect(BUDGET_BYTES.public).toBe(BUDGET_BYTES.page)
    expect(BUDGET_BYTES.runtime).toBe(1024 * 1024)
  })

  it('gives every category but ignored a finite budget', () => {
    for (const category of ASSET_CATEGORIES) {
      if (category === 'ignored') continue

      expect(Number.isFinite(BUDGET_BYTES[category]), category).toBe(true)
    }
  })
})

describe('PerfBudgetsPlugin', () => {
  function fakeCompilation(
    assets: Record<string, number>,
    copied: string[] = []
  ): {
    warnings: any[]
    errors: any[]
    assets: Record<string, any>
    getAsset: (name: string) => {info: {copied?: boolean}} | undefined
  } {
    const built: Record<string, any> = {}

    for (const [name, size] of Object.entries(assets)) {
      built[name] = {size: () => size}
    }

    return {
      warnings: [],
      errors: [],
      assets: built,
      getAsset: (name) =>
        name in built
          ? {info: copied.includes(name) ? {copied: true} : {}}
          : undefined
    }
  }

  function applyAndRun(
    plugin: PerfBudgetsPlugin,
    mode: 'production' | 'development',
    assets: Record<string, number>,
    copied: string[] = []
  ) {
    const compilation: any = fakeCompilation(assets, copied)

    let processAssetsCb: () => void = () => {}

    compilation.hooks = {
      processAssets: {
        tap: (_opts: unknown, fn: () => void) => {
          processAssetsCb = fn
        }
      }
    }

    const compiler: any = {
      options: {mode},
      hooks: {
        thisCompilation: {
          tap: (_name: string, fn: (c: any) => void) => fn(compilation)
        }
      },
      rspack: {
        WebpackError: class extends Error {},
        Compilation: {PROCESS_ASSETS_STAGE_REPORT: 5000}
      }
    }
    plugin.apply(compiler)
    processAssetsCb()

    return compilation
  }

  it('warns when a content-script bundle exceeds 512 KiB', () => {
    const compilation = applyAndRun(new PerfBudgetsPlugin(), 'production', {
      'content_scripts/content-0.abc12345.js': 600 * 1024
    })
    expect(compilation.warnings).toHaveLength(1)
    expect(compilation.warnings[0].name).toBe('PerfBudgetWarning')
    expect(String(compilation.warnings[0].message)).toContain(
      'content_scripts/content-0.abc12345.js'
    )

    expect(String(compilation.warnings[0].message)).toContain('content script')
  })

  it('does not warn for binary assets even when very large', () => {
    const compilation = applyAndRun(new PerfBudgetsPlugin(), 'production', {
      'assets/screenshot.png': 5 * 1024 * 1024
    })
    expect(compilation.warnings).toHaveLength(0)
  })

  it('warns when a top-level wasm core exceeds the runtime budget', () => {
    const compilation = applyAndRun(new PerfBudgetsPlugin(), 'production', {
      '03bc89f8e5771202.wasm': 20 * 1024 * 1024
    })
    expect(compilation.warnings).toHaveLength(1)
    const msg = String(compilation.warnings[0].message)
    expect(msg).toContain('03bc89f8e5771202.wasm')
    expect(msg).toContain('runtime payload')
  })

  it('warns when the shared chunk exceeds its own budget', () => {
    const compilation = applyAndRun(new PerfBudgetsPlugin(), 'production', {
      'shared/framework.js': 600 * 1024
    })
    expect(compilation.warnings).toHaveLength(1)
    const msg = String(compilation.warnings[0].message)
    expect(msg).toContain('shared/framework.js')
    expect(msg).toContain('shared chunk')
    expect(msg).toContain('512.0 KiB')
  })

  it('names a copied public file by its own role, with its own remedy', () => {
    const compilation = applyAndRun(
      new PerfBudgetsPlugin(),
      'production',
      {'vendor/lib.js': 1500 * 1024},
      ['vendor/lib.js']
    )
    expect(compilation.warnings).toHaveLength(1)
    const msg = String(compilation.warnings[0].message)
    expect(msg).toContain('vendor/lib.js')
    expect(msg).toContain('copied public file, shipped as authored')
    expect(msg).not.toContain('UI page')
    expect(msg).toContain('A public/ file ships as authored')
    expect(msg).not.toContain('code-split')
  })

  it('keeps the bundler remedy when a page and a copied file both overflow', () => {
    const compilation = applyAndRun(
      new PerfBudgetsPlugin(),
      'production',
      {'vendor/lib.js': 1500 * 1024, 'pages/main.js': 1500 * 1024},
      ['vendor/lib.js']
    )
    const msg = String(compilation.warnings[0].message)
    expect(msg).toContain('copied public file, shipped as authored')
    expect(msg).toContain('UI page, opened on demand')
    expect(msg).toContain('code-split')
    expect(msg).toContain('A public/ file ships as authored')
  })

  it('warns when an override page or a panel exceeds the page budget', () => {
    const compilation = applyAndRun(new PerfBudgetsPlugin(), 'production', {
      'chrome_url_overrides/newtab.js': 1500 * 1024,
      'panel/index.js': 1500 * 1024,
      'scripts/script-one.js': 600 * 1024
    })
    expect(compilation.warnings).toHaveLength(1)
    const msg = String(compilation.warnings[0].message)
    expect(msg).toContain('chrome_url_overrides/newtab.js')
    expect(msg).toContain('panel/index.js')
    expect(msg).toContain('scripts/script-one.js')
  })

  it('does not warn in development mode by default', () => {
    const compilation = applyAndRun(new PerfBudgetsPlugin(), 'development', {
      'content_scripts/content-0.js': 5 * 1024 * 1024
    })
    expect(compilation.warnings).toHaveLength(0)
  })

  it('honors an enabled override regardless of mode', () => {
    const compilation = applyAndRun(
      new PerfBudgetsPlugin({enabled: true}),
      'development',
      {'sidebar/index.js': 2 * 1024 * 1024}
    )
    expect(compilation.warnings).toHaveLength(1)
  })

  it('honors per-category budget overrides', () => {
    const compilation = applyAndRun(
      new PerfBudgetsPlugin({
        budgets: {'content-script': 2 * 1024 * 1024}
      }),
      'production',
      {'content_scripts/content-0.js': 600 * 1024}
    )
    expect(compilation.warnings).toHaveLength(0)
  })

  it('honors a runtime budget override for a large wasm core', () => {
    const wasm = {'03bc89f8e5771202.wasm': 20 * 1024 * 1024}
    const raised = applyAndRun(
      new PerfBudgetsPlugin({budgets: {runtime: 25 * 1024 * 1024}}),
      'production',
      wasm
    )
    expect(raised.warnings).toHaveLength(0)

    const lowered = applyAndRun(
      new PerfBudgetsPlugin({budgets: {runtime: 10 * 1024 * 1024}}),
      'production',
      wasm
    )
    expect(lowered.warnings).toHaveLength(1)
    expect(String(lowered.warnings[0].message)).toContain('10.00 MiB')
  })

  it('reports multiple oversized assets sorted by size desc', () => {
    const compilation = applyAndRun(new PerfBudgetsPlugin(), 'production', {
      'content_scripts/content-0.js': 700 * 1024,
      'sidebar/index.js': 1500 * 1024,
      'background/service_worker.js': 600 * 1024
    })
    expect(compilation.warnings).toHaveLength(1)
    const msg = String(compilation.warnings[0].message)
    const sidebarIdx = msg.indexOf('sidebar/index.js')
    const swIdx = msg.indexOf('background/service_worker.js')
    const csIdx = msg.indexOf('content_scripts/content-0.js')
    expect(sidebarIdx).toBeGreaterThan(-1)
    expect(swIdx).toBeGreaterThan(-1)
    expect(csIdx).toBeGreaterThan(-1)
    expect(sidebarIdx).toBeLessThan(csIdx)
    expect(csIdx).toBeLessThan(swIdx)
  })
})
