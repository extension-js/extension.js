import {describe, expect, it} from 'vitest'
import {
  isSfcStyleBlockQuery,
  readStyleBlockProxyRequest,
  sfcStyleBlockId
} from '../css-lib/sfc-style-block'
import deadCssUrlLoader from '../dead-css-url-loader'
import sfcStyleBlockLoader from '../sfc-style-block-loader'

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
