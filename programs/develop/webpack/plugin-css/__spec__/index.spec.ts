import {describe, it, expect, vi, beforeEach} from 'vitest'
import {CssPlugin} from '../index'

vi.mock('../css-tools/stylelint', () => ({
  maybeUseStylelint: vi.fn(async () => [{name: 'stylelint-plugin'}])
}))

vi.mock('../css-in-content-script-loader', () => ({
  cssInContentScriptLoader: vi.fn(async () => [
    {test: /cs/, name: 'content-rule'}
  ])
}))

vi.mock('../css-in-html-loader', () => ({
  cssInHtmlLoader: vi.fn(async () => [{test: /html/, name: 'html-rule'}])
}))

vi.mock('../css-tools/sass', () => ({
  maybeUseSass: vi.fn(async () => [])
}))

vi.mock('../css-tools/less', () => ({
  maybeUseLess: vi.fn(async () => [])
}))

describe('CssPlugin', () => {
  const makeCompiler = (mode: 'development' | 'production' = 'development') => {
    const hooks: any = {beforeRun: {tapPromise: vi.fn()}}
    return {
      options: {
        mode,
        plugins: [],
        module: {rules: [] as any[]}
      },
      hooks
    } as any
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies configuration immediately in development', async () => {
    const compiler = makeCompiler('development')
    const plugin = new CssPlugin({
      manifestPath: '/project/manifest.json'
    } as any)

    await plugin.apply(compiler as any)

    expect(compiler.options.plugins).toEqual([{name: 'stylelint-plugin'}])
    expect(compiler.options.module.rules).toEqual([
      {test: /cs/, name: 'content-rule'},
      {test: /html/, name: 'html-rule'}
    ])
  })

  it('defers configuration to beforeRun in production', async () => {
    const compiler = makeCompiler('production')
    const plugin = new CssPlugin({
      manifestPath: '/project/manifest.json'
    } as any)

    await plugin.apply(compiler as any)

    expect(compiler.hooks.beforeRun.tapPromise).toHaveBeenCalled()

    // simulate Rspack calling the hook
    const call = compiler.hooks.beforeRun.tapPromise.mock.calls[0]
    const hookFn = call[1] as () => Promise<void>
    await hookFn()

    expect(compiler.options.plugins).toEqual([{name: 'stylelint-plugin'}])
    expect(compiler.options.module.rules).toEqual([
      {test: /cs/, name: 'content-rule'},
      {test: /html/, name: 'html-rule'}
    ])
  })

  it('adds content-script asset rules for sass/less when detected', async () => {
    const {maybeUseSass} = (await import('../css-tools/sass')) as any
    const {maybeUseLess} = (await import('../css-tools/less')) as any
    ;(maybeUseSass as any).mockResolvedValue([{}])
    ;(maybeUseLess as any).mockResolvedValue([{}])

    const compiler = makeCompiler('development')
    const plugin = new CssPlugin({
      manifestPath: '/project/manifest.json'
    } as any)

    await plugin.apply(compiler as any)

    // 2 base rules + 1 sass asset rule + 1 less asset rule
    expect(compiler.options.module.rules.length).toBe(4)
    const sassRule = compiler.options.module.rules[2]
    const lessRule = compiler.options.module.rules[3]
    expect(sassRule.type).toBe('asset/resource')
    expect(lessRule.type).toBe('asset/resource')
    expect(typeof sassRule.issuer).toBe('function')
    expect(typeof lessRule.issuer).toBe('function')
  })
})
