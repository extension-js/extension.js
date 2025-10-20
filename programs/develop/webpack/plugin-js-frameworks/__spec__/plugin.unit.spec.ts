import {describe, it, expect, vi, beforeEach} from 'vitest'

import {JsFrameworksPlugin} from '..'

// Mock detectors and installers to return predictable results
vi.mock('../js-tools/babel', () => ({
  maybeUseBabel: vi.fn(async () => ({
    alias: {babel: '/abs/babel'},
    loaders: [{loader: 'babel-loader'}],
    plugins: []
  }))
}))

vi.mock('../js-tools/react', () => ({
  isUsingReact: () => true,
  maybeUseReact: vi.fn(async () => ({
    alias: {react: '/abs/react'},
    loaders: [],
    plugins: [{apply: vi.fn()}]
  }))
}))

vi.mock('../js-tools/preact', () => ({
  isUsingPreact: () => false,
  maybeUsePreact: vi.fn(async () => undefined)
}))

vi.mock('../js-tools/vue', () => ({
  maybeUseVue: vi.fn(async () => ({
    alias: undefined,
    loaders: [{loader: 'vue-loader'}],
    plugins: [{apply: vi.fn()}]
  }))
}))

vi.mock('../js-tools/svelte', () => ({
  maybeUseSvelte: vi.fn(async () => ({
    alias: undefined,
    loaders: [{loader: 'svelte-loader'}],
    plugins: [{apply: vi.fn()}]
  }))
}))

vi.mock('../js-tools/typescript', () => ({
  isUsingTypeScript: () => true,
  getUserTypeScriptConfigFile: () => '/proj/tsconfig.json'
}))

describe('JsFrameworksPlugin', () => {
  const manifestPath = '/proj/manifest.json'
  let compiler: any

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    compiler = {
      options: {
        mode: 'development',
        context: '/context',
        resolve: {alias: {}},
        module: {rules: []}
      },
      hooks: {beforeRun: {tapPromise: vi.fn()}}
    }
  })

  it('configures aliases, rules, plugins and tsconfig in development', async () => {
    const plugin = new JsFrameworksPlugin({manifestPath, mode: 'development'})
    await plugin.apply(compiler)

    expect(compiler.options.resolve.alias).toMatchObject({
      babel: '/abs/babel',
      react: '/abs/react'
    })

    const firstRule = compiler.options.module.rules[0]
    expect(firstRule.use.loader).toContain('swc')

    const rules = compiler.options.module.rules
    expect(rules.some((r: any) => r.loader === 'vue-loader')).toBe(true)
    expect(rules.some((r: any) => r.loader === 'svelte-loader')).toBe(true)

    expect(compiler.options.resolve.tsConfig.configFile).toBe(
      '/proj/tsconfig.json'
    )
  })

  it('defers configuration to beforeRun in production', async () => {
    compiler.options.mode = 'production'
    const plugin = new JsFrameworksPlugin({manifestPath, mode: 'production'})
    await plugin.apply(compiler)
    expect(compiler.hooks.beforeRun.tapPromise).toHaveBeenCalled()
  })
})
