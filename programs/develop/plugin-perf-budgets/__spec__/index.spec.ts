import {describe, it, expect} from 'vitest'
import {BUDGET_BYTES, categorizeAsset, PerfBudgetsPlugin} from '../index'

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
      'popup',
      'options',
      'devtools',
      'newtab',
      'sandbox'
    ]) {
      expect(categorizeAsset(`${dir}/index.js`)).toBe('page')
    }
  })

  it('ignores binaries, source maps, hot updates, and unknown locations', () => {
    expect(categorizeAsset('assets/icon.png')).toBe('ignored')
    expect(categorizeAsset('assets/font.woff2')).toBe('ignored')
    expect(categorizeAsset('content_scripts/content-0.js.map')).toBe('ignored')
    expect(categorizeAsset('hot/123.abcdef.js')).toBe('ignored')
    expect(categorizeAsset('manifest.json')).toBe('ignored')
    expect(categorizeAsset('_locales/en/messages.json')).toBe('ignored')
  })
})

describe('BUDGET_BYTES', () => {
  it('applies tighter budgets to hot paths than to cold UI pages', () => {
    expect(BUDGET_BYTES['content-script']).toBeLessThan(BUDGET_BYTES.page)
    expect(BUDGET_BYTES['service-worker']).toBeLessThan(BUDGET_BYTES.page)
    expect(BUDGET_BYTES.ignored).toBe(Number.POSITIVE_INFINITY)
  })

  it('matches the documented 256/200/500 KiB targets', () => {
    expect(BUDGET_BYTES['content-script']).toBe(256 * 1024)
    expect(BUDGET_BYTES['service-worker']).toBe(200 * 1024)
    expect(BUDGET_BYTES.page).toBe(500 * 1024)
  })
})

describe('PerfBudgetsPlugin', () => {
  function fakeCompilation(assets: Record<string, number>): {
    warnings: any[]
    errors: any[]
    assets: Record<string, any>
  } {
    const built: Record<string, any> = {}
    for (const [name, size] of Object.entries(assets)) {
      built[name] = {size: () => size}
    }
    return {warnings: [], errors: [], assets: built}
  }

  function applyAndRun(
    plugin: PerfBudgetsPlugin,
    mode: 'production' | 'development',
    assets: Record<string, number>
  ) {
    const compilation = fakeCompilation(assets)
    let cb: (compilation: any) => void = () => {}
    const compiler: any = {
      options: {mode},
      hooks: {
        afterCompile: {
          tap: (_name: string, fn: (c: any) => void) => {
            cb = fn
          }
        }
      },
      rspack: {WebpackError: class extends Error {}}
    }
    plugin.apply(compiler)
    cb(compilation)
    return compilation
  }

  it('warns when a content-script bundle exceeds 256 KiB', () => {
    const compilation = applyAndRun(new PerfBudgetsPlugin(), 'production', {
      'content_scripts/content-0.abc12345.js': 300 * 1024
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
      {'sidebar/index.js': 1024 * 1024}
    )
    expect(compilation.warnings).toHaveLength(1)
  })

  it('honors per-category budget overrides', () => {
    const compilation = applyAndRun(
      new PerfBudgetsPlugin({
        budgets: {'content-script': 1024 * 1024}
      }),
      'production',
      {'content_scripts/content-0.js': 200 * 1024}
    )
    expect(compilation.warnings).toHaveLength(0)
  })

  it('reports multiple oversized assets sorted by size desc', () => {
    const compilation = applyAndRun(new PerfBudgetsPlugin(), 'production', {
      'content_scripts/content-0.js': 300 * 1024,
      'sidebar/index.js': 800 * 1024,
      'background/service_worker.js': 250 * 1024
    })
    expect(compilation.warnings).toHaveLength(1)
    const msg = String(compilation.warnings[0].message)
    const sidebarIdx = msg.indexOf('sidebar/index.js')
    const swIdx = msg.indexOf('background/service_worker.js')
    const csIdx = msg.indexOf('content_scripts/content-0.js')
    expect(sidebarIdx).toBeGreaterThan(-1)
    expect(swIdx).toBeGreaterThan(-1)
    expect(csIdx).toBeGreaterThan(-1)
    // Sidebar (800 KiB) > CS (300 KiB) > SW (250 KiB)
    expect(sidebarIdx).toBeLessThan(csIdx)
    expect(csIdx).toBeLessThan(swIdx)
  })
})
