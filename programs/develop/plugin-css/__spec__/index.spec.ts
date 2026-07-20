import {beforeEach, describe, expect, it, vi} from 'vitest'

const mockedContentLoaders = [{test: /a\.css$/}]
const mockedHtmlLoaders = [{test: /b\.css$/}]

vi.mock('../css-tools/sass', () => ({
  maybeUseSass: vi.fn(async () => undefined)
}))

vi.mock('../css-tools/less', () => ({
  maybeUseLess: vi.fn(async () => undefined)
}))

vi.mock('../css-in-content-script-loader', () => ({
  cssInContentScriptLoader: vi.fn(async () => mockedContentLoaders)
}))

vi.mock('../css-in-html-loader', () => ({
  cssInHtmlLoader: vi.fn(async () => mockedHtmlLoaders)
}))

import {CssPlugin} from '../index'

function createCompiler(
  mode: 'development' | 'production' | 'none' = 'development'
) {
  const beforeRun: any = {
    tapPromise: vi.fn((_name: string, cb: () => Promise<void>) => {
      ;(beforeRun as any)._cb = cb
    })
  }
  const watchRun: any = {
    tapPromise: vi.fn((_name: string, cb: () => Promise<void>) => {
      ;(watchRun as any)._cb = cb
    })
  }

  return {
    options: {
      mode,
      plugins: [] as any[],
      module: {rules: [] as any[]},
      output: {} as Record<string, unknown>
    },
    hooks: {beforeRun, watchRun}
  } as any
}

describe('CssPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies loaders and plugins in development mode immediately', async () => {
    const compiler = createCompiler('development')
    const plugin = new CssPlugin({manifestPath: '/project/manifest.json'})

    await plugin.apply(compiler)

    expect(compiler.options.module.rules.length).toBeGreaterThanOrEqual(
      mockedContentLoaders.length + mockedHtmlLoaders.length
    )
  })

  it('defers configuration to beforeRun in production mode', async () => {
    const compiler = createCompiler('production')
    const plugin = new CssPlugin({manifestPath: '/project/manifest.json'})

    await plugin.apply(compiler)

    expect(compiler.hooks.beforeRun.tapPromise).toHaveBeenCalled()

    await (compiler.hooks.beforeRun as any)._cb()

    expect(compiler.options.module.rules.length).toBeGreaterThanOrEqual(
      mockedContentLoaders.length + mockedHtmlLoaders.length
    )
  })

  it('does not add separate asset/resource rules for SASS/LESS content scripts (cssInContentScriptLoader owns this)', async () => {
    const compiler = createCompiler('development')
    const plugin = new CssPlugin({manifestPath: '/project/manifest.json'})

    await plugin.apply(compiler)

    const rules = compiler.options.module.rules as any[]
    expect(rules.some((r) => r.type === 'asset/resource')).toBe(false)
  })

  it('appends a type-only asset/source rule for `?inline` stylesheet requests after the issuer-based rules', async () => {
    const compiler = createCompiler('development')
    const plugin = new CssPlugin({manifestPath: '/project/manifest.json'})

    await plugin.apply(compiler)

    const rules = compiler.options.module.rules as any[]
    const inlineRule = rules.find(
      (r) => r.resourceQuery && r.type === 'asset/source'
    )
    expect(inlineRule).toBeDefined()
    expect(inlineRule.use).toBeUndefined()
    expect(inlineRule.issuer).toBeUndefined()
    expect(rules.indexOf(inlineRule)).toBe(rules.length - 1)

    const query = inlineRule.resourceQuery as RegExp
    expect(query.test('?vue&type=style&index=0&id=x&inline&lang=css')).toBe(
      true
    )
    expect(query.test('?inline')).toBe(true)
    expect(query.test('?vue&type=style&index=0&id=x&lang=css')).toBe(false)
    expect(query.test('?no-inline-here=1')).toBe(false)
    expect(query.test('?inlineLimit=4096')).toBe(false)
  })
})
