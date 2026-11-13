import {describe, expect, it} from 'vitest'
import {
  dropSourceMapComment,
  isSfcInlineStyleBlockQuery,
  isSfcModuleStyleBlockQuery,
  isSfcStyleBlockQuery,
  readStyleBlockProxyRequest,
  SVELTE_STYLE_BLOCK_TEST,
  sfcStyleBlockId
} from '../css-lib/sfc-style-block'
import deadCssUrlLoader from '../dead-css-url-loader'
import sfcStyleBlockLoader, {pitch} from '../sfc-style-block-loader'

const STYLE_QUERY = '?vue&type=style&index=0&id=731d5dd6&scoped=true&lang=css'
const OWN_PATH = '/develop/dist/sfc-style-block-loader.mjs'

// What vue-loader's pitcher answers for a block when native CSS is on.
const PROXY =
  '@import "./Widget.vue.css?vue&type=style&index=0&id=731d5dd6&scoped=true&lang=css!=!-!../node_modules/vue-loader/dist/stylePostLoader.js!../node_modules/vue-loader/dist/index.js??ruleSet[0]!./Widget.vue?vue&type=style&index=0&id=731d5dd6&scoped=true&lang=css";'

function context(overrides: Record<string, unknown> = {}) {
  return {
    resourcePath: '/project/src/Widget.vue',
    resourceQuery: STYLE_QUERY,
    mode: 'production',
    loaderIndex: 0,
    loaders: [{path: OWN_PATH}, {path: '/vue-loader/dist/index.js'}],
    getOptions: () => ({
      manifestPath: '/project/manifest.json',
      projectPath: '/project'
    }),
    emitWarning() {},
    emitError() {},
    ...overrides
  } as any
}

describe('sfc style block loader', () => {
  it('turns the one-line @import proxy into a JavaScript import', () => {
    const output = sfcStyleBlockLoader.call(context(), PROXY)

    expect(output).toBe(`import ${JSON.stringify(PROXY.slice(9, -2))};\n`)
    expect(output).not.toContain('@import')
  })

  it('turns the finished sheet into a module that adds a <style> element', () => {
    const output = sfcStyleBlockLoader.call(
      context(),
      '.probe[data-v-731d5dd6] { color: rgb(1, 2, 3); }'
    )

    expect(output).toContain('.probe[data-v-731d5dd6] { color: rgb(1, 2, 3); }')
    expect(output).toContain('createElement("style")')
    expect(output).toContain(sfcStyleBlockId('src/Widget.vue', STYLE_QUERY, ''))
  })

  it("keeps a block's own @import as CSS", () => {
    const output = sfcStyleBlockLoader.call(context(), '@import "./theme.css";')

    expect(output).toContain('createElement("style")')
    expect(output).not.toMatch(/^import /)
  })

  it('leaves the sheet alone in every copy but the one that runs last', () => {
    const css = '.probe { color: red; }'
    const laterCopy = context({
      loaderIndex: 2,
      loaders: [
        {path: OWN_PATH},
        {path: '/vue-loader/dist/stylePostLoader.js'},
        {path: OWN_PATH}
      ]
    })

    expect(sfcStyleBlockLoader.call(laterCopy, css)).toBe(css)
  })

  it('leaves any module that is not a style block alone', () => {
    const css = '.probe { color: red; }'

    expect(sfcStyleBlockLoader.call(context({resourceQuery: ''}), css)).toBe(
      css
    )
  })

  it('gives a development build an id of its own per project', () => {
    const output = sfcStyleBlockLoader.call(
      context({mode: 'development'}),
      '.probe { color: red; }'
    )

    expect(output).toContain(
      sfcStyleBlockId('src/Widget.vue', STYLE_QUERY, '/project')
    )

    expect(sfcStyleBlockId('a.vue', STYLE_QUERY, '/one')).not.toBe(
      sfcStyleBlockId('a.vue', STYLE_QUERY, '/two')
    )
  })
})

describe('style block helpers', () => {
  it('recognizes a vue style block query and nothing else', () => {
    expect(isSfcStyleBlockQuery(STYLE_QUERY)).toBe(true)
    expect(isSfcStyleBlockQuery('?vue&type=template&id=1')).toBe(false)
    expect(isSfcStyleBlockQuery('?revue&type=style')).toBe(false)
    expect(isSfcStyleBlockQuery(undefined)).toBe(false)
  })

  it('reads a proxy only from a lone @import of a loader request', () => {
    expect(readStyleBlockProxyRequest(PROXY)).toBe(PROXY.slice(9, -2))
    expect(readStyleBlockProxyRequest('@import "./theme.css";')).toBeUndefined()
    expect(
      readStyleBlockProxyRequest(`${PROXY}\n.a { color: red; }`)
    ).toBeUndefined()
  })
})

describe('dead css url loader', () => {
  it('hands a style block on as CSS for the loaders after it', () => {
    const css = '.probe { color: red; }'

    expect(deadCssUrlLoader.call(context(), css)).toBe(css)
    expect(deadCssUrlLoader.call(context({resourceQuery: ''}), css)).toContain(
      'data:text/css'
    )
  })
})

describe('a Svelte style block', () => {
  // svelte-loader hands the block over under the component's own path.
  const svelte = (overrides: Record<string, unknown> = {}) =>
    context({
      resourcePath: '/project/src/Widget.svelte',
      resourceQuery: '',
      loaders: [{path: OWN_PATH}, {path: '/svelte-loader/index.js'}],
      ...overrides
    })
  const css = '.probe.svelte-pvphsg { color: rgb(1, 2, 3); }'
  const mapped = `${css}\n/*# sourceMappingURL=data:application/json;base64,e30= */`

  it('is matched by the name svelte-loader gives it and no other sheet', () => {
    expect(SVELTE_STYLE_BLOCK_TEST.test('/p/src/Widget.svelte.3.css')).toBe(
      true
    )

    expect(SVELTE_STYLE_BLOCK_TEST.test('/p/src/widget.css')).toBe(false)
    expect(SVELTE_STYLE_BLOCK_TEST.test('/p/src/a.svelte.css')).toBe(false)
  })

  it('stays CSS through the stylesheet loader', () => {
    expect(deadCssUrlLoader.call(svelte(), css)).toBe(css)
  })

  it('becomes a module that adds a <style> element under a stable id', () => {
    const output = sfcStyleBlockLoader.call(svelte(), css)

    expect(output).toContain(css)
    expect(output).toContain('createElement("style")')
    expect(output).toContain(sfcStyleBlockId('src/Widget.svelte', '', ''))
    expect(output).not.toContain('data:text/css')
  })

  it('ships no source map comment in production and keeps it in development', () => {
    expect(sfcStyleBlockLoader.call(svelte(), mapped)).not.toContain(
      'sourceMappingURL'
    )

    expect(
      sfcStyleBlockLoader.call(svelte({mode: 'development'}), mapped)
    ).toContain('sourceMappingURL')
  })

  it('drops only a source map comment that ends the sheet', () => {
    expect(dropSourceMapComment(mapped)).toBe(`${css}\n`)
    expect(dropSourceMapComment(css)).toBe(css)
    expect(dropSourceMapComment(`${mapped}\n.b { color: red; }`)).toBe(
      `${mapped}\n.b { color: red; }`
    )
  })
})

describe('an inline style block of a custom element component', () => {
  const INLINE_QUERY =
    '?vue&type=style&index=0&id=324a41f4&inline&scoped=true&lang=css'
  const INLINE_PROXY = `@import "./Ce.ce.vue.css${INLINE_QUERY}!=!-!../node_modules/vue-loader/dist/stylePostLoader.js!./Ce.ce.vue${INLINE_QUERY}";`

  function inline(exports: unknown) {
    const imported: string[] = []
    let result: {error: Error | null; content?: string} | undefined
    const loader = context({
      resourcePath: '/project/src/Ce.ce.vue',
      resourceQuery: INLINE_QUERY,
      async: () => (error: Error | null, content?: string) => {
        result = {error, content}
      },
      importModule(
        request: string,
        _options: unknown,
        callback: (error: Error | null, exports: unknown) => void
      ) {
        imported.push(request)
        callback(null, exports)
      }
    })

    return {loader, imported, result: () => result}
  }

  it('recognizes the inline flag as a whole parameter', () => {
    expect(isSfcInlineStyleBlockQuery(INLINE_QUERY)).toBe(true)
    expect(isSfcInlineStyleBlockQuery(STYLE_QUERY)).toBe(false)
    expect(
      isSfcInlineStyleBlockQuery('?vue&type=style&index=0&inlineLimit=1')
    ).toBe(false)

    expect(isSfcInlineStyleBlockQuery('?inline')).toBe(false)
  })

  it("answers the proxy with the compiled block's text", () => {
    const css = '.probe[data-v-324a41f4] { color: rgb(4, 5, 6); }'
    const {loader, imported, result} = inline(css)

    expect(sfcStyleBlockLoader.call(loader, INLINE_PROXY)).toBeUndefined()
    expect(imported).toEqual([INLINE_PROXY.slice(8, -1).replace(/^"|"$/g, '')])
    expect(result()).toEqual({error: null, content: css})
  })

  it('reads the text from a default export too', () => {
    const {loader, result} = inline({default: '.a { color: red; }'})

    sfcStyleBlockLoader.call(loader, INLINE_PROXY)

    expect(result()?.content).toBe('.a { color: red; }')
  })

  it('leaves the compiled block as text, with no <style> element', () => {
    const css = '.probe[data-v-324a41f4] { color: rgb(4, 5, 6); }'
    const {loader} = inline(css)

    expect(sfcStyleBlockLoader.call(loader, css)).toBe(css)
  })
})

describe('a <style module> block', () => {
  const MODULE_QUERY =
    '?vue&type=style&index=1&id=89f40504&module=named&lang=scss'
  const PITCHER = '/deps/node_modules/vue-loader/dist/pitcher.js'
  const loaders = [
    {path: OWN_PATH, request: `${OWN_PATH}??ruleSet[1].rules[40]`},
    {path: PITCHER, request: `${PITCHER}??ruleSet[1].rules[0]`},
    {path: '/deps/sass-loader.js', request: '/deps/sass-loader.js??sass'},
    {path: '/deps/sass-loader.js', request: '/deps/sass-loader.js??sass'},
    {
      path: '/deps/node_modules/vue-loader/dist/index.js',
      request: '/deps/node_modules/vue-loader/dist/index.js??ruleSet[0]'
    }
  ]
  const moduleContext = (overrides: Record<string, unknown> = {}) =>
    context({
      resourcePath: '/project/src/Page.vue',
      resourceQuery: MODULE_QUERY,
      loaders,
      ...overrides
    })

  it('recognizes a module block, named or not', () => {
    expect(isSfcModuleStyleBlockQuery(MODULE_QUERY)).toBe(true)
    expect(
      isSfcModuleStyleBlockQuery('?vue&type=style&index=0&module=true&lang=css')
    ).toBe(true)

    expect(isSfcModuleStyleBlockQuery(STYLE_QUERY)).toBe(false)
    expect(isSfcModuleStyleBlockQuery('?vue&type=script&module=true')).toBe(
      false
    )
  })

  it("re-exports a CSS module built by the block's own loaders, ahead of the pitcher that refuses it", () => {
    const request = [
      '/project/src/Page.vue.1.module.scss!=!-',
      '/deps/node_modules/vue-loader/dist/stylePostLoader.js',
      '/deps/sass-loader.js??sass',
      '/deps/node_modules/vue-loader/dist/index.js??ruleSet[0]',
      `/project/src/Page.vue${MODULE_QUERY}`
    ].join('!')

    expect(pitch.call(moduleContext())).toBe(
      `export {default} from ${JSON.stringify(request)};\n` +
        `export * from ${JSON.stringify(request)};\n`
    )
  })

  it('names the request relative to the importer where the bundler can', () => {
    const output = pitch.call(
      moduleContext({
        context: '/project/src',
        utils: {
          contextify: (_context: string, request: string) =>
            request.split('/project/src/').join('./')
        }
      })
    )

    expect(output).toContain('"./Page.vue.1.module.scss!=!-!')
    expect(output).not.toContain('/project/src/')
  })

  it('stays out of the way of every other block and of a chain with no pitcher', () => {
    expect(
      pitch.call(moduleContext({resourceQuery: STYLE_QUERY}))
    ).toBeUndefined()

    expect(
      pitch.call(moduleContext({loaders: [loaders[0], loaders[4]]}))
    ).toBeUndefined()
  })
})
