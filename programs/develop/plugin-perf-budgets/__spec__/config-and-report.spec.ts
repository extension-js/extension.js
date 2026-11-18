import * as fs from 'node:fs'
import * as path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {type Compilation, type Compiler, rspack} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {budgetSurfaceOf, manifestEntriesOf} from '../categorize'
import {
  categorizeAsset,
  collectAssetReferrers,
  PerfBudgetsPlugin,
  resetPerfBudgetNotices,
  resolvePerfBudgets
} from '../index'
import {type OversizedAsset, perfBudgetWarning} from '../messages'

const makeTempFolder = trackTempFolders()
const MiB = 1024 * 1024

type Chunk = {
  name?: string
  files?: string[]
  auxiliaryFiles?: string[]
}

function run(
  plugin: PerfBudgetsPlugin,
  assets: Record<string, number | string>,
  chunks: Chunk[] = [],
  chunkGraph: object = {}
) {
  const built: Record<string, object> = {}

  for (const [name, value] of Object.entries(assets)) {
    built[name] =
      typeof value === 'number'
        ? {size: () => value}
        : {size: () => value.length, source: () => value}
  }

  let report: () => void = () => {}

  const compilation = {
    warnings: [] as Error[],
    errors: [],
    assets: built,
    chunks,
    chunkGraph,
    getAsset: (name: string) => (name in built ? {info: {}} : undefined),
    hooks: {
      afterProcessAssets: {
        tap: (_name: string, fn: () => void) => {
          report = fn
        }
      }
    }
  }
  const tapped: string[] = []

  plugin.apply({
    options: {mode: 'production'},
    hooks: {
      thisCompilation: {
        tap: (name: string, fn: (c: unknown) => void) => {
          tapped.push(name)
          fn(compilation)
        }
      }
    },
    rspack: {WebpackError: class extends Error {}}
  } as never)

  report()

  return {compilation, tapped}
}

function messageOf(compilation: {warnings: Error[]}): string {
  expect(compilation.warnings).toHaveLength(1)

  return String(compilation.warnings[0].message)
}

function lineOf(call: unknown[]): string {
  return stripVTControlCharacters(String(call[0]))
}

function thrownBy(fn: () => unknown): {code?: string; message: string} {
  try {
    fn()
  } catch (error) {
    return {
      code: (error as {code?: string}).code,
      message: stripVTControlCharacters((error as Error).message)
    }
  }

  throw new Error('expected a refusal')
}

const contentScript = (auxiliaryFiles: string[]): Chunk[] => [
  {
    name: 'content_scripts/content-0',
    files: ['content_scripts/content-0.js'],
    auxiliaryFiles
  }
]

describe('the remedy names the budget that applied', () => {
  it('says perfBudgets.runtime for a wasm file a content script reaches', () => {
    const {compilation} = run(
      new PerfBudgetsPlugin(),
      {'assets/core.wasm': 2 * MiB},
      contentScript(['assets/core.wasm'])
    )
    const message = messageOf(compilation)

    expect(message).toContain(
      'fetch it from your own server on demand, raise perfBudgets.runtime in extension.config.js when this size is intended, or list the file under perfBudgets.ignore.'
    )

    expect(message).not.toContain('perfBudgets.wasm')
  })

  it('says perfBudgets.wasm for a wasm file only a page reaches', () => {
    const {compilation} = run(new PerfBudgetsPlugin(), {
      'assets/core.wasm': 40 * MiB
    })

    expect(messageOf(compilation)).toContain(
      'raise perfBudgets.wasm in extension.config.js when this size is intended'
    )
  })

  it('names each budget when two of them applied', () => {
    const {compilation} = run(
      new PerfBudgetsPlugin(),
      {'assets/hot.wasm': 2 * MiB, 'assets/cold.wasm': 40 * MiB},
      contentScript(['assets/hot.wasm'])
    )

    expect(messageOf(compilation)).toContain(
      'raise the budget that applied in extension.config.js when this size is intended (perfBudgets.wasm for a file only pages and workers reach, perfBudgets.runtime for a file a content script or the service worker reaches), or list the file under perfBudgets.ignore.'
    )
  })
})

describe('a perfBudgets value of the wrong type is refused', () => {
  const CONFIG = '/project/extension.config.js'

  it('refuses ignore as a string instead of reading it letter by letter', () => {
    expect(
      thrownBy(() => resolvePerfBudgets({ignore: 'assets/*.wasm'}, CONFIG))
    ).toEqual({
      code: 'E_CONFIG_LOAD',
      message:
        '⏵⏵⏵ perfBudgets.ignore in extension.config.js must be an array of strings, found the string "assets/*.wasm".\n' +
        'PATH /project/extension.config.js\n' +
        "List each output path or glob as its own entry, for example ignore: ['assets/*.wasm']."
    })
  })

  it('refuses ignore as a number or as an array holding a non-string', () => {
    expect(thrownBy(() => resolvePerfBudgets({ignore: 5})).message).toBe(
      '⏵⏵⏵ perfBudgets.ignore in extension.config.js must be an array of strings, found the number 5.\n' +
        "List each output path or glob as its own entry, for example ignore: ['assets/*.wasm']."
    )

    expect(
      thrownBy(() => resolvePerfBudgets({ignore: ['a.js', 5]})).message
    ).toContain('must be an array of strings, found an array.')
  })

  it.each([
    ['10', 'the string "10"'],
    [Number.NaN, 'the number NaN'],
    [Number.POSITIVE_INFINITY, 'the number Infinity'],
    [0, 'the number 0'],
    [-5, 'the number -5'],
    [null, 'null'],
    [[1], 'an array']
  ])('refuses the budget %j', (value, found) => {
    expect(thrownBy(() => resolvePerfBudgets({public: value}, CONFIG))).toEqual(
      {
        code: 'E_CONFIG_LOAD',
        message:
          `⏵⏵⏵ perfBudgets.public in extension.config.js must be a finite number of bytes above 0, found ${found}.\n` +
          'PATH /project/extension.config.js\n' +
          "Write the budget in bytes, for example 'public': 2 * 1024 * 1024. To stop budgeting a file, list it under perfBudgets.ignore."
      }
    )
  })

  it('refuses a perfBudgets that is not an object', () => {
    expect(thrownBy(() => resolvePerfBudgets(5)).message).toBe(
      '⏵⏵⏵ perfBudgets in extension.config.js must be an object, found the number 5.\n' +
        'Write one budget in bytes per category, for example perfBudgets: {wasm: 48 * 1024 * 1024}.'
    )
  })

  it('fails in apply, before the plugin taps the compiler', () => {
    const tapped: string[] = []
    const compiler = {
      options: {mode: 'production'},
      hooks: {thisCompilation: {tap: (name: string) => tapped.push(name)}}
    }

    expect(
      thrownBy(() =>
        new PerfBudgetsPlugin({budgets: {ignore: 5 as never}}).apply(
          compiler as never
        )
      ).code
    ).toBe('E_CONFIG_LOAD')

    expect(tapped).toEqual([])
  })

  it('takes a valid block as written', () => {
    const resolved = resolvePerfBudgets({
      wasm: 48 * MiB,
      ignore: ['assets/*.wasm', ' ']
    })

    expect(resolved.budgets.wasm).toBe(48 * MiB)
    expect(resolved.budgets.page).toBe(MiB)
    expect(resolved.ignore).toEqual(['assets/*.wasm'])
    expect(resolved.onExceed).toBe('warn')
    expect(resolved.unknownKeys).toEqual([])
  })
})

describe('perfBudgets.onExceed', () => {
  const CONFIG = '/project/extension.config.js'

  it('is warn when left out, and reads warn and error as written', () => {
    expect(resolvePerfBudgets(undefined).onExceed).toBe('warn')
    expect(resolvePerfBudgets({page: 5}).onExceed).toBe('warn')
    expect(resolvePerfBudgets({onExceed: 'warn'}).onExceed).toBe('warn')

    const resolved = resolvePerfBudgets({onExceed: 'error'})

    expect(resolved.onExceed).toBe('error')
    expect(resolved.unknownKeys).toEqual([])
  })

  it.each([
    ['fail', 'the string "fail"'],
    ['Error', 'the string "Error"'],
    [true, 'a boolean'],
    [1, 'the number 1'],
    [null, 'null'],
    [['error'], 'an array']
  ])('refuses the value %j', (value, found) => {
    expect(
      thrownBy(() => resolvePerfBudgets({onExceed: value}, CONFIG))
    ).toEqual({
      code: 'E_CONFIG_LOAD',
      message:
        `⏵⏵⏵ perfBudgets.onExceed in extension.config.js must be 'warn' or 'error', found ${found}.\n` +
        'PATH /project/extension.config.js\n' +
        "Write onExceed: 'error' to fail the build when a file is over its budget, or leave it out to keep the warning."
    })
  })

  it('reports an overrun as one error and no warning under error', () => {
    const {compilation} = run(
      new PerfBudgetsPlugin({budgets: {onExceed: 'error'}}),
      {'sidebar/index.js': 2 * MiB, 'sidebar/index.html': 9 * MiB}
    )
    const errors = compilation.errors as Error[]

    expect(compilation.warnings).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].name).toBe('PerfBudgetError')
    expect(errors[0].message).toBe(
      `${perfBudgetWarning([
        {
          name: 'sidebar/index.js',
          size: 2 * MiB,
          budget: MiB,
          category: 'page'
        }
      ])}\n\n` +
        "The build failed because perfBudgets.onExceed is 'error' in extension.config.js. Remove it or set it to 'warn' to report an overrun without failing."
    )
  })

  it('reports nothing under error when every file is within its budget', () => {
    const {compilation} = run(
      new PerfBudgetsPlugin({budgets: {onExceed: 'error'}}),
      {'sidebar/index.js': 100, 'sidebar/index.html': 9 * MiB}
    )

    expect(compilation.errors).toEqual([])
    expect(compilation.warnings).toEqual([])
  })

  it('keeps the warning under warn', () => {
    const {compilation} = run(
      new PerfBudgetsPlugin({budgets: {onExceed: 'warn'}}),
      {'sidebar/index.js': 2 * MiB}
    )

    expect(compilation.errors).toEqual([])
    expect(compilation.warnings).toHaveLength(1)
    expect(compilation.warnings[0].name).toBe('PerfBudgetWarning')
  })
})

describe('a perfBudgets key nothing reads', () => {
  let printed: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetPerfBudgetNotices()
    printed = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    printed.mockRestore()
  })

  it('warns once with the accepted keys, and the typo changes no budget', () => {
    const plugin = new PerfBudgetsPlugin({budgets: {publc: 10} as never})
    const {compilation} = run(plugin, {'sidebar/index.js': 100})

    run(plugin, {'sidebar/index.js': 100})

    expect(compilation.warnings).toEqual([])
    expect(printed.mock.calls.map(lineOf)).toEqual([
      '⏵⏵⏵ perfBudgets in extension.config.js declares a key nothing reads: publc.\n' +
        'Accepted keys are content-script, service-worker, page, shared, public, runtime, wasm, ignore, onExceed.'
    ])
  })

  it('counts ignored as a key nothing reads', () => {
    expect(resolvePerfBudgets({ignored: 10, page: 5}).unknownKeys).toEqual([
      'ignored'
    ])

    run(new PerfBudgetsPlugin({budgets: {ignored: 10} as never}), {})

    expect(lineOf(printed.mock.calls[0])).toContain(
      'declares a key nothing reads: ignored.'
    )
  })
})

describe('commands.dev.perfBudgets', () => {
  let printed: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetPerfBudgetNotices()
    printed = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    printed.mockRestore()
  })

  async function devSession(config: string) {
    const dir = makeTempFolder('tmp-extjs-dev-budgets-')
    const configPath = path.join(dir, 'extension.config.js')
    fs.writeFileSync(configPath, `module.exports = ${config}\n`)

    let watchRun: () => Promise<void> = async () => {}

    const compilationTaps: string[] = []

    new PerfBudgetsPlugin({budgets: {page: 5}}).apply({
      options: {mode: 'development', context: dir},
      hooks: {
        watchRun: {
          tapPromise: (_name: string, fn: () => Promise<void>) => {
            watchRun = fn
          }
        },
        thisCompilation: {tap: (name: string) => compilationTaps.push(name)}
      }
    } as never)

    await watchRun()
    await watchRun()

    return {configPath, compilationTaps}
  }

  it('warns once that it has no effect, and runs no budget in dev', async () => {
    const {configPath, compilationTaps} = await devSession(
      '{commands: {dev: {perfBudgets: {page: 5}}}}'
    )

    expect(compilationTaps).toEqual([])
    expect(printed.mock.calls.map(lineOf)).toEqual([
      '⏵⏵⏵ commands.dev.perfBudgets in extension.config.js has no effect: size budgets are checked on a production build only.\n' +
        `PATH ${configPath}\n` +
        'Move it to commands.build.perfBudgets or to the top-level perfBudgets.'
    ])
  })

  it('says nothing when the budgets come from another layer', async () => {
    await devSession(
      '{perfBudgets: {page: 5}, commands: {build: {perfBudgets: {page: 5}}}}'
    )

    expect(printed.mock.calls).toEqual([])
  })
})

describe('the warning text', () => {
  const oversized = (count: number): OversizedAsset[] =>
    Array.from({length: count}, (_, index) => ({
      name: `sidebar/chunk-${index}.js`,
      size: 2 * MiB,
      budget: MiB,
      category: 'page' as const
    }))

  it('states what the budgets are, with no comparison to another tool', () => {
    expect(perfBudgetWarning(oversized(1)).split('\n')[0]).toBe(
      'One asset exceeds the extension performance budget. Browser extensions inject content scripts on every navigation and wake service workers from cold, so Extension.js budgets each file by the surface that loads it.'
    )
  })

  it('lists 20 assets at most, then counts the rest', () => {
    const lines = perfBudgetWarning(oversized(25)).split('\n')
    const names = lines.filter((line) => /^ {2}sidebar\//.test(line))

    expect(lines[0]).toMatch(/^25 assets exceed /)
    expect(names).toHaveLength(20)
    expect(names[0]).toBe('  sidebar/chunk-0.js')
    expect(lines[2 + 20 * 4]).toBe('  and 5 more')
  })

  it('adds no count line at 20 assets', () => {
    expect(perfBudgetWarning(oversized(20))).not.toContain(' more')
  })

  it('keeps the largest when the plugin has more than 20 to report', () => {
    const assets: Record<string, number> = {}

    for (let index = 0; index < 30; index++) {
      assets[`sidebar/chunk-${index}.js`] = 2 * MiB + index
    }

    const message = messageOf(run(new PerfBudgetsPlugin(), assets).compilation)

    expect(message).toContain('  sidebar/chunk-29.js\n')
    expect(message).toContain('  sidebar/chunk-10.js\n')
    expect(message).not.toContain('  sidebar/chunk-9.js\n')
    expect(message).toContain('\n  and 10 more\n')
  })
})

describe('which files are budgeted, and as what', () => {
  it('budgets .mjs and .cjs like .js, and leaves .html alone', () => {
    expect(categorizeAsset('sidebar/index.mjs')).toBe('page')
    expect(categorizeAsset('background/service_worker.mjs')).toBe(
      'service-worker'
    )

    expect(categorizeAsset('vendor/lib.cjs', {copied: true})).toBe('public')
    expect(categorizeAsset('worker.cjs')).toBe('runtime')
    expect(categorizeAsset('sidebar/index.html')).toBe('ignored')

    const {compilation} = run(new PerfBudgetsPlugin(), {
      'sidebar/index.mjs': 2 * MiB,
      'sidebar/index.html': 2 * MiB
    })

    expect(messageOf(compilation)).toMatch(/^One asset exceeds /)
  })

  it('matches a whole folder name, not a prefix of one', () => {
    expect(categorizeAsset('backgrounds/hero.js')).toBe('page')
    expect(categorizeAsset('background-art/hero.js')).toBe('page')
    expect(categorizeAsset('sidebar/service_worker.js')).toBe('page')
    expect(categorizeAsset('background.js')).toBe('runtime')
    expect(categorizeAsset('background/service_worker.js')).toBe(
      'service-worker'
    )

    expect(categorizeAsset('service_worker.js')).toBe('service-worker')
    expect(budgetSurfaceOf('backgrounds/hero')).toBe('page')
    expect(budgetSurfaceOf('scripts-old/tool')).toBe('page')
  })

  it('reads the service worker and content scripts the manifest names', () => {
    const entries = manifestEntriesOf(
      JSON.stringify({
        background: {service_worker: './sw/main.js', scripts: ['bg/one.js']},
        content_scripts: [{js: ['inject/a.js'], css: ['inject/a.css']}]
      })
    )

    expect(categorizeAsset('sw/main.js', {}, [], entries)).toBe(
      'service-worker'
    )

    expect(categorizeAsset('bg/one.js', {}, [], entries)).toBe('service-worker')
    expect(categorizeAsset('inject/a.js', {}, [], entries)).toBe(
      'content-script'
    )

    expect(categorizeAsset('inject/a.css', {}, [], entries)).toBe(
      'content-script'
    )

    expect(categorizeAsset('inject/b.js', {}, [], entries)).toBe('page')
    expect(manifestEntriesOf('not json').background.size).toBe(0)

    const {compilation} = run(new PerfBudgetsPlugin(), {
      'manifest.json': JSON.stringify({background: {service_worker: 'sw.js'}}),
      'sw.js': 600 * 1024
    })

    expect(messageOf(compilation)).toContain('budget: 512.0 KiB')
  })

  it('keeps a wasm file the MV2 background page reaches on the runtime budget', () => {
    const chunks: Chunk[] = [
      {
        name: 'background/index',
        files: ['background/index.js'],
        auxiliaryFiles: ['assets/core.wasm']
      }
    ]

    expect([
      ...(collectAssetReferrers({chunks, chunkGraph: {}} as never).get(
        'assets/core.wasm'
      ) || [])
    ]).toEqual(['background'])

    const {compilation} = run(
      new PerfBudgetsPlugin(),
      {'assets/core.wasm': 2 * MiB},
      chunks
    )

    expect(messageOf(compilation)).toContain('budget: 1.00 MiB')
  })
})

describe('a chunk graph that refuses a read', () => {
  const refusing = {
    getChunkModulesIterable: () => {
      throw new Error('graph gone')
    }
  }
  const page: Chunk[] = [
    {
      name: 'sidebar/index',
      files: ['sidebar/index.js'],
      auxiliaryFiles: ['assets/core.wasm']
    }
  ]

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('tells the caller, and still answers what it could read', () => {
    const heard = vi.fn()
    const referrers = collectAssetReferrers(
      {chunks: page, chunkGraph: refusing} as never,
      heard
    )

    expect(heard).toHaveBeenCalled()
    expect([...(referrers.get('assets/core.wasm') || [])]).toEqual(['page'])
  })

  it('keeps the runtime budget for a wasm file instead of the looser one', () => {
    const {compilation} = run(
      new PerfBudgetsPlugin(),
      {'assets/core.wasm': 2 * MiB},
      page,
      refusing
    )
    const message = messageOf(compilation)

    expect(message).toContain('budget: 1.00 MiB  (over by 100%)')
    expect(message).toContain('raise perfBudgets.runtime in')
  })

  it('says so in debug output', () => {
    vi.stubEnv('EXTENSION_DEBUG', '1')
    const printed = vi.spyOn(console, 'log').mockImplementation(() => {})

    run(new PerfBudgetsPlugin(), {'assets/core.wasm': 100}, page, refusing)

    expect(printed.mock.calls.map(lineOf)).toEqual([
      '··· budgets  wasm=runtime reason=chunk-graph-unreadable files=assets/core.wasm'
    ])
  })

  it('leaves the wasm budget alone when every read answers', () => {
    const {compilation} = run(
      new PerfBudgetsPlugin(),
      {'assets/core.wasm': 2 * MiB},
      page
    )

    expect(compilation.warnings).toEqual([])
  })
})

describe('sizes are read after the last asset stage', () => {
  it('counts bytes another plugin appends past the report stage', async () => {
    const dir = makeTempFolder('tmp-extjs-budget-stage-')
    fs.writeFileSync(path.join(dir, 'entry.js'), 'console.log("entry")\n')

    const padding = `/*${'x'.repeat(4096)}*/`
    const compiler = rspack({
      context: dir,
      mode: 'production',
      entry: {'sidebar/index': './entry.js'},
      output: {path: path.join(dir, 'dist'), filename: '[name].js'},
      performance: false,
      plugins: [
        new PerfBudgetsPlugin({budgets: {page: 2048}}),
        {
          apply(target: Compiler) {
            target.hooks.thisCompilation.tap(
              'late-shim',
              (compilation: Compilation) => {
                compilation.hooks.processAssets.tap(
                  {
                    name: 'late-shim',
                    stage: rspack.Compilation.PROCESS_ASSETS_STAGE_REPORT + 900
                  },
                  () => {
                    compilation.updateAsset(
                      'sidebar/index.js',
                      (source) =>
                        new rspack.sources.ConcatSource(padding, source)
                    )
                  }
                )
              }
            )
          }
        }
      ]
    })

    const warnings = await new Promise<string[]>((resolve, reject) => {
      compiler.run((error, stats) => {
        compiler.close(() => {
          if (error) return reject(error)

          resolve(
            (stats?.compilation.warnings || []).map((warning) =>
              String(warning.message)
            )
          )
        })
      })
    })

    expect(warnings).toHaveLength(1)
    // The bundler prints its own gutter before each line of a warning.
    expect(warnings[0]).toMatch(
      /sidebar\/index\.js\n.*size: {3}4\.0 KiB\n.*budget: 2\.0 KiB {2}\(over by 101%\)/
    )
  })
})
