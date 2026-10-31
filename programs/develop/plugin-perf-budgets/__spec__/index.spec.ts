import {describe, expect, it} from 'vitest'
import {
  ASSET_CATEGORIES,
  BUDGET_BYTES,
  categorizeAsset,
  collectAssetReferrers,
  ignorePatternToRegExp,
  PerfBudgetsPlugin
} from '../index'

type FakeChunk = {
  name?: string | null
  id?: number
  runtime?: string[]
  files?: string[]
  auxiliaryFiles?: string[]
  groupsIterable?: Array<{origins: Array<{module: object | null}>}>
}

type FakeModule = {identifier(): string; modules?: FakeModule[]}

type FakeGraph = {
  chunks: FakeChunk[]
  moduleChunks?: Map<object, FakeChunk[]>
  chunkModules?: Map<FakeChunk, FakeModule[]>
}

const ORT_WASM = 'assets/ort-wasm-simd-threaded.asyncify.wasm'
const MiB = 1024 * 1024

function fakeChunkGraph(graph?: FakeGraph) {
  return {
    getModuleChunksIterable: (module: object) =>
      graph?.moduleChunks?.get(module) || [],
    getChunkModulesIterable: (chunk: FakeChunk) =>
      graph?.chunkModules?.get(chunk) || []
  }
}

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

  it('classifies top-level runtime helpers as runtime', () => {
    expect(categorizeAsset('ffmpeg-core.js')).toBe('runtime')
    expect(categorizeAsset('ffmpeg-core.worker.js')).toBe('runtime')
  })

  it('classifies every .wasm file as wasm, wherever it lands', () => {
    expect(categorizeAsset('03bc89f8e5771202.wasm')).toBe('wasm')
    expect(categorizeAsset('assets/ffmpeg-core.wasm')).toBe('wasm')
    expect(categorizeAsset('assets/ort-wasm-simd-threaded.asyncify.wasm')).toBe(
      'wasm'
    )

    expect(categorizeAsset('sidebar/engine.wasm')).toBe('wasm')
  })

  it('keeps a wasm file a hot surface reaches under the runtime budget', () => {
    expect(categorizeAsset(ORT_WASM, {}, [])).toBe('wasm')
    expect(categorizeAsset(ORT_WASM, {}, ['page'])).toBe('wasm')
    expect(categorizeAsset('03bc89f8e5771202.wasm', {}, ['page'])).toBe('wasm')

    expect(categorizeAsset(ORT_WASM, {}, ['content_script'])).toBe('runtime')
    expect(categorizeAsset(ORT_WASM, {}, ['page', 'content_script'])).toBe(
      'runtime'
    )

    expect(categorizeAsset(ORT_WASM, {}, ['script'])).toBe('runtime')
    expect(categorizeAsset(ORT_WASM, {}, ['background'])).toBe('runtime')
    expect(categorizeAsset('03bc89f8e5771202.wasm', {}, ['background'])).toBe(
      'runtime'
    )
  })

  it('keeps a copied wasm under the public budget', () => {
    expect(categorizeAsset('vendor/core.wasm', {copied: true}, ['page'])).toBe(
      'public'
    )
  })
})

describe('ignorePatternToRegExp', () => {
  it('matches an exact output path and nothing else', () => {
    const pattern = ignorePatternToRegExp(ORT_WASM)

    expect(pattern.test(ORT_WASM)).toBe(true)
    expect(pattern.test('assets/ort-wasm-simd-threaded.jsep.wasm')).toBe(false)
    expect(pattern.test(`x/${ORT_WASM}`)).toBe(false)
  })

  it('keeps * inside one folder and lets ** span folders', () => {
    expect(ignorePatternToRegExp('assets/*.wasm').test(ORT_WASM)).toBe(true)
    expect(
      ignorePatternToRegExp('assets/*.wasm').test('assets/ort/core.wasm')
    ).toBe(false)

    expect(
      ignorePatternToRegExp('assets/**/*.wasm').test('assets/ort/core.wasm')
    ).toBe(true)

    expect(ignorePatternToRegExp('**/*.wasm').test(ORT_WASM)).toBe(true)
    expect(ignorePatternToRegExp('**/*.wasm').test('pages/main.js')).toBe(false)
  })

  it('reads a leading ./ and backslashes as the printed path', () => {
    expect(ignorePatternToRegExp(`./${ORT_WASM}`).test(ORT_WASM)).toBe(true)
    expect(
      ignorePatternToRegExp(ORT_WASM.replace(/\//g, '\\')).test(ORT_WASM)
    ).toBe(true)

    expect(ignorePatternToRegExp('pages/main.js').test('pages/mainXjs')).toBe(
      false
    )
  })
})

describe('collectAssetReferrers', () => {
  it('maps files to the surfaces of their entry, runtime and origin chunks', () => {
    const page: FakeChunk = {
      name: 'pages/engine',
      files: ['pages/engine.js'],
      auxiliaryFiles: [ORT_WASM]
    }
    const lazy: FakeChunk = {
      id: 7,
      runtime: ['pages/engine'],
      files: ['pages/engine.lazy.js'],
      auxiliaryFiles: ['assets/model.wasm']
    }
    const creator = {}
    const worker: FakeChunk = {
      id: 8,
      runtime: ['8'],
      files: ['pages/worker.js'],
      auxiliaryFiles: ['assets/worker-core.wasm'],
      groupsIterable: [{origins: [{module: creator}]}]
    }
    const content: FakeChunk = {
      name: 'content_scripts/content-0',
      files: ['content_scripts/content-0.js'],
      auxiliaryFiles: ['assets/cs-core.wasm']
    }
    const graph: FakeGraph = {
      chunks: [page, lazy, worker, content],
      moduleChunks: new Map([[creator, [page]]])
    }
    const referrers = collectAssetReferrers({
      chunks: graph.chunks,
      chunkGraph: fakeChunkGraph(graph)
    } as any)

    expect([...(referrers.get(ORT_WASM) || [])]).toEqual(['page'])
    expect([...(referrers.get('assets/model.wasm') || [])]).toEqual(['page'])
    expect([...(referrers.get('assets/worker-core.wasm') || [])]).toEqual([
      'page'
    ])

    expect([...(referrers.get('assets/cs-core.wasm') || [])]).toEqual([
      'content_script'
    ])

    expect(referrers.get('assets/nobody.wasm')).toBeUndefined()
  })

  it('resolves a worker whose creator a production build concatenated away', () => {
    const creator: FakeModule = {identifier: () => '/project/engine/index.js'}
    const concatenated: FakeModule = {
      identifier: () => '/project/engine/index.js|concatenated',
      modules: [creator]
    }
    const page: FakeChunk = {
      name: 'options/index',
      files: ['options/index.js']
    }
    const worker: FakeChunk = {
      id: 423,
      runtime: ['cb195bd4912dfbc7'],
      files: ['423.js'],
      auxiliaryFiles: ['assets/core.19e703a7.wasm'],
      groupsIterable: [{origins: [{module: creator}]}]
    }
    const referrers = collectAssetReferrers({
      chunks: [page, worker],
      chunkGraph: fakeChunkGraph({
        chunks: [page, worker],
        chunkModules: new Map([[page, [concatenated]]])
      })
    } as any)

    expect([...(referrers.get('assets/core.19e703a7.wasm') || [])]).toEqual([
      'page'
    ])

    expect([...(referrers.get('423.js') || [])]).toEqual(['page'])
  })
})

describe('BUDGET_BYTES', () => {
  it('applies tighter budgets to hot paths than to cold UI pages', () => {
    expect(BUDGET_BYTES['content-script']).toBeLessThan(BUDGET_BYTES.page)
    expect(BUDGET_BYTES['service-worker']).toBeLessThan(BUDGET_BYTES.page)
    expect(BUDGET_BYTES.shared).toBeLessThan(BUDGET_BYTES.page)
    expect(BUDGET_BYTES.runtime).toBe(BUDGET_BYTES.page)
    expect(BUDGET_BYTES.wasm).toBeGreaterThan(BUDGET_BYTES.page)
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

  it('gives a wasm runtime room for an on-device ML core', () => {
    expect(BUDGET_BYTES.wasm).toBe(32 * 1024 * 1024)
    expect(BUDGET_BYTES.wasm).toBeGreaterThan(26 * 1024 * 1024)
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
    copied: string[] = [],
    graph?: FakeGraph
  ): {
    warnings: any[]
    errors: any[]
    assets: Record<string, any>
    chunks: FakeChunk[]
    chunkGraph: ReturnType<typeof fakeChunkGraph>
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
      chunks: graph?.chunks || [],
      chunkGraph: fakeChunkGraph(graph),
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
    copied: string[] = [],
    graph?: FakeGraph
  ) {
    const compilation: any = fakeCompilation(assets, copied, graph)

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

  it('says nothing about a 26 MB WebAssembly runtime, which is its normal size', () => {
    const compilation = applyAndRun(new PerfBudgetsPlugin(), 'production', {
      'assets/ort-wasm-simd-threaded.asyncify.wasm': 26 * 1024 * 1024,
      '03bc89f8e5771202.wasm': 20 * 1024 * 1024
    })
    expect(compilation.warnings).toHaveLength(0)
  })

  it('warns for a wasm core past its own budget, with a wasm remedy and no code-splitting advice', () => {
    const compilation = applyAndRun(new PerfBudgetsPlugin(), 'production', {
      'assets/ort-wasm-simd-threaded.asyncify.wasm': 40 * 1024 * 1024
    })
    expect(compilation.warnings).toHaveLength(1)
    const msg = String(compilation.warnings[0].message)
    expect(msg).toContain('ort-wasm-simd-threaded.asyncify.wasm')
    expect(msg).toContain('WebAssembly runtime')
    expect(msg).toContain('32.00 MiB')
    expect(msg).toContain('cannot be code-split')
    expect(msg).toContain('perfBudgets.wasm')
    expect(msg).toContain('perfBudgets.ignore')
    expect(msg).not.toContain('Lazy-load with dynamic import()')
  })

  // The ledger case: onnxruntime-web's 26 MB core, reached by one page.
  function pageGraph(auxiliaryFiles: string[]): FakeGraph {
    return {
      chunks: [
        {name: 'pages/engine', files: ['pages/engine.js'], auxiliaryFiles}
      ]
    }
  }

  function contentScriptGraph(auxiliaryFiles: string[]): FakeGraph {
    return {
      chunks: [
        {
          name: 'content_scripts/content-0',
          files: ['content_scripts/content-0.js'],
          auxiliaryFiles
        }
      ]
    }
  }

  it('does not warn for a 26 MB wasm runtime only a page reaches', () => {
    const compilation = applyAndRun(
      new PerfBudgetsPlugin(),
      'production',
      {[ORT_WASM]: 26 * 1000 * 1000, 'pages/engine.js': 40 * 1024},
      [],
      pageGraph([ORT_WASM])
    )
    expect(compilation.warnings).toHaveLength(0)
  })

  it('does not warn for a 26 MB wasm runtime only a worker reaches', () => {
    const creator = {}
    const page: FakeChunk = {
      name: 'pages/engine',
      files: ['pages/engine.js']
    }
    const worker: FakeChunk = {
      id: 3,
      runtime: ['3'],
      files: ['pages/worker.js'],
      auxiliaryFiles: [ORT_WASM],
      groupsIterable: [{origins: [{module: creator}]}]
    }
    const compilation = applyAndRun(
      new PerfBudgetsPlugin(),
      'production',
      {[ORT_WASM]: 26 * 1000 * 1000, 'pages/worker.js': 40 * 1024},
      [],
      {chunks: [page, worker], moduleChunks: new Map([[creator, [page]]])}
    )
    expect(compilation.warnings).toHaveLength(0)
  })

  it('still warns for the same wasm runtime when a content script reaches it', () => {
    const compilation = applyAndRun(
      new PerfBudgetsPlugin(),
      'production',
      {[ORT_WASM]: 26 * 1000 * 1000},
      [],
      contentScriptGraph([ORT_WASM])
    )
    expect(compilation.warnings).toHaveLength(1)
    const msg = String(compilation.warnings[0].message)
    expect(msg).toContain(ORT_WASM)
    expect(msg).toContain('reached by a content script')
    expect(msg).toContain('1.00 MiB')
    expect(msg).toContain('perfBudgets.ignore')
    expect(msg).not.toContain('Lazy-load with dynamic import()')
  })

  it('still warns for a wasm runtime the service worker reaches', () => {
    const compilation = applyAndRun(
      new PerfBudgetsPlugin(),
      'production',
      {'03bc89f8e5771202.wasm': 20 * 1024 * 1024},
      [],
      {
        chunks: [
          {
            name: 'background/service_worker',
            files: ['background/service_worker.js'],
            auxiliaryFiles: ['03bc89f8e5771202.wasm']
          }
        ]
      }
    )
    expect(compilation.warnings).toHaveLength(1)
    expect(String(compilation.warnings[0].message)).toContain(
      '03bc89f8e5771202.wasm'
    )
  })

  it('silences an asset listed under ignore, exact or by glob', () => {
    for (const ignore of [[ORT_WASM], ['assets/*.wasm'], ['**/*.wasm']]) {
      const compilation = applyAndRun(
        new PerfBudgetsPlugin({budgets: {ignore}}),
        'production',
        {[ORT_WASM]: 26 * 1000 * 1000},
        [],
        contentScriptGraph([ORT_WASM])
      )
      expect(compilation.warnings, ignore.join(',')).toHaveLength(0)
    }

    const other = applyAndRun(
      new PerfBudgetsPlugin({budgets: {ignore: ['assets/other.wasm']}}),
      'production',
      {[ORT_WASM]: 26 * 1000 * 1000},
      [],
      contentScriptGraph([ORT_WASM])
    )
    expect(other.warnings).toHaveLength(1)
  })

  it('ignores only the named asset, so an oversize page still warns', () => {
    const compilation = applyAndRun(
      new PerfBudgetsPlugin({ignore: [ORT_WASM]}),
      'production',
      {[ORT_WASM]: 26 * 1000 * 1000, 'pages/engine.js': 1500 * 1024},
      [],
      pageGraph([ORT_WASM])
    )
    expect(compilation.warnings).toHaveLength(1)
    const msg = String(compilation.warnings[0].message)
    expect(msg).toContain('pages/engine.js')
    expect(msg).not.toContain(ORT_WASM)
    expect(msg).toContain('code-split')
  })

  it('still warns for an oversize non-wasm asset beside a budgeted wasm', () => {
    const compilation = applyAndRun(
      new PerfBudgetsPlugin(),
      'production',
      {
        [ORT_WASM]: 26 * 1000 * 1000,
        'ffmpeg-core.js': 2 * MiB,
        'pages/engine.js': 1500 * 1024
      },
      [],
      pageGraph([ORT_WASM, 'ffmpeg-core.js'])
    )
    expect(compilation.warnings).toHaveLength(1)
    const msg = String(compilation.warnings[0].message)
    expect(msg).toContain('ffmpeg-core.js')
    expect(msg).toContain('pages/engine.js')
    expect(msg).not.toContain(ORT_WASM)
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

  it('honors a wasm budget override in both directions', () => {
    const wasm = {'03bc89f8e5771202.wasm': 40 * 1024 * 1024}
    const raised = applyAndRun(
      new PerfBudgetsPlugin({budgets: {wasm: 48 * 1024 * 1024}}),
      'production',
      wasm
    )
    expect(raised.warnings).toHaveLength(0)

    const lowered = applyAndRun(
      new PerfBudgetsPlugin({budgets: {wasm: 10 * 1024 * 1024}}),
      'production',
      {'03bc89f8e5771202.wasm': 20 * 1024 * 1024}
    )
    expect(lowered.warnings).toHaveLength(1)
    expect(String(lowered.warnings[0].message)).toContain('10.00 MiB')

    // The runtime budget no longer reaches a wasm file no hot surface uses.
    const runtimeOnly = applyAndRun(
      new PerfBudgetsPlugin({budgets: {runtime: 1024}}),
      'production',
      {'03bc89f8e5771202.wasm': 20 * 1024 * 1024}
    )
    expect(runtimeOnly.warnings).toHaveLength(0)
  })

  it('honors a runtime budget override for a wasm core a content script reaches', () => {
    const wasm = {'03bc89f8e5771202.wasm': 20 * 1024 * 1024}
    const graph = contentScriptGraph(['03bc89f8e5771202.wasm'])
    const raised = applyAndRun(
      new PerfBudgetsPlugin({budgets: {runtime: 25 * 1024 * 1024}}),
      'production',
      wasm,
      [],
      graph
    )
    expect(raised.warnings).toHaveLength(0)

    const lowered = applyAndRun(
      new PerfBudgetsPlugin({budgets: {runtime: 10 * 1024 * 1024}}),
      'production',
      wasm,
      [],
      graph
    )
    expect(lowered.warnings).toHaveLength(1)
    expect(String(lowered.warnings[0].message)).toContain('10.00 MiB')

    const wasmOnly = applyAndRun(
      new PerfBudgetsPlugin({budgets: {wasm: 48 * 1024 * 1024}}),
      'production',
      wasm,
      [],
      graph
    )
    expect(wasmOnly.warnings).toHaveLength(1)
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
