import * as path from 'node:path'
import {Compilation, rspack, sources} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {
  cssSelectorTokens,
  minifierDroppedTokens,
  registerVerbatimCss,
  restoreVerbatimCssAssets,
  verbatimCssPlaceholder,
  withoutEmptyCssRules
} from '../css-lib/verbatim-css'
import {CssPlugin} from '../index'
import {cssProjects} from './helpers/css-project'

// After the minimizer, an emitted .css asset that is only the placeholder
// rule (minified or not) becomes the sheet as authored.
describe('verbatim css restore', () => {
  it('swaps a placeholder asset for the registered sheet and leaves others alone', () => {
    const raw = '.keep-a { color: red }\n.keep-b { content: "unterminated; }\n'
    const id = registerVerbatimCss(raw)
    const store = new Map<string, sources.RawSource>([
      [
        'content_scripts/content-0.css',
        new sources.RawSource(`.__extjs_verbatim_${id}__{--extjs-verbatim:1}`)
      ],
      ['pages/ok.css', new sources.RawSource('.fine{color:blue}')],
      ['bundle.js', new sources.RawSource(`"__extjs_verbatim_${id}__"`)]
    ])
    const compilation = {
      getAssets: () => [...store].map(([name, source]) => ({name, source})),
      updateAsset: (name: string, source: sources.RawSource) =>
        store.set(name, source)
    }
    expect(verbatimCssPlaceholder(id)).toContain(id)
    expect(restoreVerbatimCssAssets(compilation as any)).toEqual([
      'content_scripts/content-0.css'
    ])

    expect(
      store.get('content_scripts/content-0.css')?.source().toString()
    ).toBe(raw)

    expect(store.get('pages/ok.css')?.source().toString()).toBe(
      '.fine{color:blue}'
    )

    expect(store.get('bundle.js')?.source().toString()).toContain(
      '__extjs_verbatim_'
    )
  })
})

describe('minifier parity', () => {
  it('reads the selector tokens of a sheet and names the ones a minified copy lost', () => {
    const before =
      '.keep-a { color: red }\n@media (max-width: 600px {\n.keep-b { color: blue }\n}\n#keep-c { color: green }\n'
    expect([...cssSelectorTokens(before)]).toEqual([
      '.keep-a',
      '.keep-b',
      '#keep-c'
    ])

    expect(minifierDroppedTokens(before, '.keep-a{color:red}')).toEqual([
      '.keep-b',
      '#keep-c'
    ])

    // Merging and reordering is not a loss.
    expect(
      minifierDroppedTokens(
        '.a{color:red}.b{color:blue}',
        '.b{color:blue}.a{color:red}'
      )
    ).toEqual([])
  })

  it('does not count a rule that was empty in the source as lost', () => {
    const before =
      '.keep { color: red; }\n.a, .b { /* purposely ignored */ }\n.c { margin: 0 0 0 0; }\n'
    expect(
      minifierDroppedTokens(before, '.keep{color:red}.c{margin:0}')
    ).toEqual([])

    // An at-rule that held only empty rules is as empty as they are.
    expect(
      minifierDroppedTokens(
        '.keep{color:red}@media print{.gone{}#also-gone{;}}',
        '.keep{color:red}'
      )
    ).toEqual([])

    expect(withoutEmptyCssRules('.x { content: "{}" }')).toContain('.x')
  })

  it('still names a rule with declarations that the minified copy lost', () => {
    expect(
      minifierDroppedTokens(
        '.keep{color:red}.empty{}.lost{color:blue}',
        '.keep{color:red}'
      )
    ).toEqual(['.lost'])
  })
})

const REGISTRY_KEY = '__extensionjs_verbatim_css_registry__'

function registrySize() {
  return (
    (globalThis as unknown as Record<string, Map<string, unknown> | undefined>)[
      REGISTRY_KEY
    ]?.size ?? 0
  )
}

// Each compilation emits the placeholder the parse guard left for the sheet
// as it stands, the way a watch rebuild does after the sheet is edited.
describe('the verbatim registry through a dev session', () => {
  const makeProject = cssProjects()

  it('holds only the sheets the last compilation emitted, however many rebuilds ran', async () => {
    const root = makeProject({'entry.js': ''})
    const compiler = rspack({
      context: root,
      mode: 'development',
      devtool: false,
      entry: {main: './entry.js'},
      output: {path: path.join(root, 'out')}
    })
    void new CssPlugin({manifestPath: path.join(root, 'manifest.json')}).apply(
      compiler
    )

    let sheet = ''

    compiler.hooks.thisCompilation.tap('spec', (compilation) => {
      compilation.hooks.processAssets.tap(
        {name: 'spec', stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL},
        () => {
          const id = registerVerbatimCss(sheet, path.join(root, 'broken.css'))

          compilation.emitAsset(
            'broken.css',
            new sources.RawSource(verbatimCssPlaceholder(id))
          )
        }
      )
    })

    const before = registrySize()
    const shipped: string[] = []
    const sizes: number[] = []

    try {
      // Five edits, then a rebuild that leaves the sheet as it was.
      for (const version of [1, 2, 3, 4, 5, 5]) {
        sheet = `.v${version}{color:red`
        const compilation = await new Promise<Compilation>((resolve, reject) =>
          compiler.compile((error, result) =>
            error || !result ? reject(error) : resolve(result)
          )
        )

        shipped.push(
          String(compilation.getAsset('broken.css')?.source.source())
        )

        sizes.push(registrySize() - before)
      }
    } finally {
      await new Promise<void>((resolve) => compiler.close(() => resolve()))
    }

    // Every compilation still ships the sheet it registered.
    expect(shipped).toEqual([
      '.v1{color:red',
      '.v2{color:red',
      '.v3{color:red',
      '.v4{color:red',
      '.v5{color:red',
      '.v5{color:red'
    ])

    expect(sizes).toEqual([1, 1, 1, 1, 1, 1])
  })
})

// The parity check guards against the minimizer. A build that runs none has
// nothing to guard, so a sheet another step trims ships as that step left it.
describe('minifier parity only where a minimizer runs', () => {
  const makeProject = cssProjects()

  it.each([
    ['development', undefined, '.kept{color:red}', 0],
    ['production', false, '.kept{color:red}', 0],
    ['production', true, '.kept{color:red}\n.gone{color:blue}', 1]
  ] as const)('%s build, minimize %s', async (mode, minimize, shipped, warned) => {
    const root = makeProject({'entry.js': ''})
    const compiler = rspack({
      context: root,
      mode,
      devtool: false,
      entry: {main: './entry.js'},
      output: {path: path.join(root, 'out')},
      ...(minimize === undefined ? {} : {optimization: {minimize}})
    })
    await new CssPlugin({manifestPath: path.join(root, 'manifest.json')}).apply(
      compiler
    )

    compiler.hooks.thisCompilation.tap('spec', (compilation) => {
      compilation.hooks.processAssets.tap(
        {name: 'spec', stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL},
        () => {
          compilation.emitAsset(
            'page.css',
            new sources.RawSource('.kept{color:red}\n.gone{color:blue}')
          )
        }
      )

      // Stands in for any step that trims a sheet where a minimizer would.
      compilation.hooks.processAssets.tap(
        {name: 'spec', stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE},
        () => {
          compilation.updateAsset(
            'page.css',
            new sources.RawSource('.kept{color:red}')
          )
        }
      )
    })

    try {
      const compilation = await new Promise<Compilation>((resolve, reject) =>
        compiler.compile((error, result) =>
          error || !result ? reject(error) : resolve(result)
        )
      )

      expect(String(compilation.getAsset('page.css')?.source.source())).toBe(
        shipped
      )

      expect(
        compilation.warnings.filter((w) => /minimizer dropped/.test(w.message))
      ).toHaveLength(warned)
    } finally {
      await new Promise<void>((resolve) => compiler.close(() => resolve()))
    }
  })
})
