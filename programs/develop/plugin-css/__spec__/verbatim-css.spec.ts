import {sources} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {
  cssSelectorTokens,
  minifierDroppedTokens,
  registerVerbatimCss,
  restoreVerbatimCssAssets,
  verbatimCssPlaceholder
} from '../css-lib/verbatim-css'

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
})
