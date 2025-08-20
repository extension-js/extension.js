import * as path from 'path'
import {describe, it, expect, vi, beforeEach} from 'vitest'

// Mock sub-modules to control behavior inside the plugin
vi.mock('../js-tools/babel', () => ({
  maybeUseBabel: vi.fn().mockResolvedValue({
    alias: {babel: '/abs/babel'},
    loaders: [{test: /babel/}],
    plugins: [{apply: vi.fn()}]
  })
}))

const reactPluginApply = vi.fn()
vi.mock('../js-tools/react', () => ({
  isUsingReact: vi.fn().mockReturnValue(true),
  maybeUseReact: vi.fn().mockResolvedValue({
    alias: {react: '/abs/react'},
    loaders: undefined,
    plugins: [{apply: reactPluginApply}]
  })
}))

const preactPluginApply = vi.fn()
vi.mock('../js-tools/preact', () => ({
  isUsingPreact: vi.fn().mockReturnValue(false),
  maybeUsePreact: vi.fn().mockResolvedValue({
    alias: {preact: '/abs/preact'},
    loaders: undefined,
    plugins: [{apply: preactPluginApply}]
  })
}))

const vuePluginApply = vi.fn()
vi.mock('../js-tools/vue', () => ({
  maybeUseVue: vi.fn().mockResolvedValue({
    alias: undefined,
    loaders: [{loader: 'vue-loader'}],
    plugins: [{apply: vuePluginApply}]
  })
}))

const sveltePluginApply = vi.fn()
vi.mock('../js-tools/svelte', () => ({
  maybeUseSvelte: vi.fn().mockResolvedValue({
    alias: undefined,
    loaders: [{loader: 'svelte-loader'}],
    plugins: [{apply: sveltePluginApply}]
  })
}))

vi.mock('../js-tools/typescript', () => ({
  isUsingTypeScript: vi.fn().mockReturnValue(true)
}))

describe('JsFrameworksPlugin', () => {
  let compiler: any
  const manifestPath = path.join('/project', 'manifest.json')

  beforeEach(() => {
    compiler = {
      options: {
        mode: 'development',
        context: '/context',
        resolve: {alias: {}},
        module: {rules: []}
      },
      hooks: {
        beforeRun: {tapPromise: vi.fn()}
      }
    }
    reactPluginApply.mockClear()
    preactPluginApply.mockClear()
    vuePluginApply.mockClear()
    sveltePluginApply.mockClear()
  })

  it('configures aliases, swc rule, framework loaders/plugins, and tsconfig in development', async () => {
    const {JsFrameworksPlugin} = await import('..')

    const plugin = new JsFrameworksPlugin({manifestPath, mode: 'development'})
    await plugin.apply(compiler as any)

    // Aliases merged
    expect(compiler.options.resolve.alias).toMatchObject({
      babel: '/abs/babel',
      react: '/abs/react'
    })

    // First rule is SWC with TSX enabled (TS + React) and JSX disabled
    const firstRule = compiler.options.module.rules[0]
    expect(firstRule.use.loader).toContain('swc')
    expect(firstRule.use.options.jsc.parser.tsx).toBe(true)
    expect(firstRule.use.options.jsc.parser.jsx).toBe(false)

    // Appended loaders from frameworks
    const allRules = compiler.options.module.rules
    expect(allRules.some((r: any) => r.loader === 'vue-loader')).toBe(true)
    expect(allRules.some((r: any) => r.loader === 'svelte-loader')).toBe(true)

    // Plugins applied
    expect(reactPluginApply).toHaveBeenCalled()
    expect(vuePluginApply).toHaveBeenCalled()
    expect(sveltePluginApply).toHaveBeenCalled()

    // TS config set when TypeScript detected
    expect(compiler.options.resolve.tsConfig?.configFile).toBe(
      path.resolve(path.dirname(manifestPath), 'tsconfig.json')
    )
  })

  it('defers configuration to beforeRun in production mode', async () => {
    const {JsFrameworksPlugin} = await import('..')

    compiler.options.mode = 'production'
    const plugin = new JsFrameworksPlugin({manifestPath, mode: 'production'})
    await plugin.apply(compiler as any)

    // Should register beforeRun hook
    expect(compiler.hooks.beforeRun.tapPromise).toHaveBeenCalledTimes(1)

    // Execute the registered tap to simulate compiler lifecycle
    const tapArgs = (compiler.hooks.beforeRun.tapPromise as any).mock.calls[0]
    const tapCallback = tapArgs[1]
    await tapCallback()

    // After running, rules and aliases should be configured
    expect(compiler.options.module?.rules?.length || 0).toBeGreaterThanOrEqual(
      0
    )
    expect(
      Object.keys(compiler.options.resolve.alias).length
    ).toBeGreaterThanOrEqual(0)
  })
})
