import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as path from 'path'

const mockedReact = {
  alias: {react$: '/x/react', 'react-dom$': '/x/react-dom'},
  loaders: [{test: /react/}],
  plugins: [{apply: vi.fn()}]
} as any
const mockedPreact = {
  alias: {react: 'preact/compat'},
  loaders: [{test: /preact/}],
  plugins: [{apply: vi.fn()}]
} as any
const mockedVue = {
  alias: undefined,
  loaders: [
    {
      test: /\.vue$/,
      loader: '/mock/vue-loader',
      options: {experimentalInlineMatchResource: true}
    }
  ],
  plugins: [{apply: vi.fn()}]
} as any
const mockedSvelte = {
  alias: undefined,
  loaders: [{test: /\.svelte$/}],
  plugins: [{apply: vi.fn()}]
} as any

vi.mock('../js-tools/react', () => ({
  isUsingReact: vi.fn(() => true),
  maybeUseReact: vi.fn(async () => mockedReact)
}))
vi.mock('../js-tools/preact', () => ({
  isUsingPreact: vi.fn(() => false),
  maybeUsePreact: vi.fn(async () => mockedPreact)
}))
vi.mock('../js-tools/vue', () => ({
  maybeUseVue: vi.fn(async () => mockedVue)
}))
vi.mock('../js-tools/svelte', () => ({
  maybeUseSvelte: vi.fn(async () => mockedSvelte)
}))
vi.mock('../js-tools/typescript', () => ({
  isUsingTypeScript: vi.fn(() => true),
  getUserTypeScriptConfigFile: vi.fn(() => '/project/tsconfig.json')
}))

// Mock manifest reads inside fs.readFileSync
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    readFileSync: vi.fn((filePath: any) => {
      if (String(filePath).endsWith('manifest.json')) {
        return JSON.stringify({
          minimum_chrome_version: '120',
          browser_specific_settings: {gecko: {strict_min_version: '118.0'}}
        })
      }
      return (actual.readFileSync as any)(filePath)
    })
  }
})

import {JsFrameworksPlugin} from '../index'

function createCompiler(
  mode: 'development' | 'production' | 'none' = 'development',
  devtool?: any
) {
  const beforeRun: any = {
    tapPromise: vi.fn((_name: string, cb: () => Promise<void>) => {
      ;(beforeRun as any)._cb = cb
    })
  }

  return {
    options: {
      mode,
      devtool,
      context: '/project',
      plugins: [] as any[],
      resolve: {alias: {}, extensions: [] as string[]},
      module: {rules: [] as any[]}
    },
    hooks: {beforeRun}
  } as any
}

describe('JsFrameworksPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies aliases, SWC rule, framework loaders/plugins and tsconfig in development', async () => {
    const compiler = createCompiler('development')
    const plugin = new JsFrameworksPlugin({
      manifestPath: path.join('/project', 'manifest.json'),
      mode: 'development'
    })

    await plugin.apply(compiler)

    // Aliases merged (no babel)
    expect(compiler.options.resolve.alias).toMatchObject({
      ...mockedReact.alias,
      ...mockedPreact.alias
    })

    // Has the base SWC rule first
    const swcRule = compiler.options.module.rules[0]
    expect(String(swcRule.test)).toContain('js')
    expect(swcRule.use?.options?.env?.targets).toEqual([
      'chrome >= 120',
      'firefox >= 118'
    ])
    expect(swcRule.use?.options?.jsc?.parser?.syntax).toBe('typescript')
    expect(swcRule.use?.options?.sourceMap).toBe(true)

    // Framework loaders appended
    const tests = compiler.options.module.rules.map((r: any) => String(r.test))
    expect(tests.some((t: string) => t.includes('\\.vue'))).toBe(true)
    expect(tests.some((t: string) => t.includes('\\.svelte'))).toBe(true)

    // Framework plugins applied
    expect(mockedReact.plugins?.[0].apply).toHaveBeenCalled()
    expect(mockedPreact.plugins?.[0].apply).toHaveBeenCalled()
    expect(mockedVue.plugins?.[0].apply).toHaveBeenCalled()
    expect(mockedSvelte.plugins?.[0].apply).toHaveBeenCalled()

    // tsconfig is set
    expect(compiler.options.resolve.tsConfig?.configFile).toBe(
      '/project/tsconfig.json'
    )
  })

  it('defers configuration to beforeRun in production', async () => {
    const compiler = createCompiler('production')
    const plugin = new JsFrameworksPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'production'
    })

    await plugin.apply(compiler)
    expect(compiler.hooks.beforeRun.tapPromise).toHaveBeenCalled()

    // Simulate the hook being called by Rspack
    await (compiler.hooks.beforeRun as any)._cb()

    // Now the SWC rule should be present
    const swcRule = compiler.options.module.rules[0]
    expect(swcRule?.use?.options?.minify).toBe(true)
  })

  it('enables SWC sourcemaps in production when devtool is enabled', async () => {
    const compiler = createCompiler('production', 'hidden-source-map')
    const plugin = new JsFrameworksPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'production'
    })

    await plugin.apply(compiler)
    await (compiler.hooks.beforeRun as any)._cb()

    const swcRule = compiler.options.module.rules[0]
    expect(swcRule?.use?.options?.sourceMap).toBe(true)
  })

  it('disables SWC sourcemaps in development when devtool is explicitly false', async () => {
    const compiler = createCompiler('development', false)
    const plugin = new JsFrameworksPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'development'
    })

    await plugin.apply(compiler)

    const swcRule = compiler.options.module.rules[0]
    expect(swcRule?.use?.options?.sourceMap).toBe(false)
  })

  it('does not add a second vue-loader rule when the user already configured one', async () => {
    const compiler = createCompiler('development')
    const isCustomElement = vi.fn((tag: string) => tag.startsWith('ion-'))

    // Simulate a user-provided vue-loader rule coming from extension.config.js
    compiler.options.module.rules.push({
      test: /\.vue$/,
      loader: '/mock/vue-loader',
      options: {
        compilerOptions: {isCustomElement}
      }
    })

    const plugin = new JsFrameworksPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'development'
    })

    await plugin.apply(compiler)

    const vueRules = compiler.options.module.rules.filter((r: any) =>
      String(r?.test).includes('\\.vue')
    )
    expect(vueRules.length).toBe(1)
    expect(vueRules[0].options.compilerOptions.isCustomElement).toBe(
      isCustomElement
    )
    // Ensure our default options are present (merged into the user rule)
    expect(vueRules[0].options.experimentalInlineMatchResource).toBe(true)
  })
})
