import {describe, it, expect, vi, beforeEach} from 'vitest'

// Mocks for internal dependencies used by CssPlugin
const mockedStylelintPlugins = [{}]
const mockedContentLoaders = [{test: /a\.css$/}]
const mockedHtmlLoaders = [{test: /b\.css$/}]

vi.mock('../css-tools/stylelint', () => ({
  maybeUseStylelint: vi.fn(async () => mockedStylelintPlugins)
}))

vi.mock('../css-tools/sass', () => ({
  maybeUseSass: vi.fn(async () => [{}])
}))

vi.mock('../css-tools/less', () => ({
  maybeUseLess: vi.fn(async () => [{}])
}))

vi.mock('../css-in-content-script-loader', () => ({
  cssInContentScriptLoader: vi.fn(async () => mockedContentLoaders)
}))

vi.mock('../css-in-html-loader', () => ({
  cssInHtmlLoader: vi.fn(async () => mockedHtmlLoaders)
}))

// Import after mocks
import {CssPlugin} from '../index'

function createCompiler(
  mode: 'development' | 'production' | 'none' = 'development'
) {
  const beforeRun: any = {
    tapPromise: vi.fn((_name: string, cb: () => Promise<void>) => {
      ;(beforeRun as any)._cb = cb
    })
  }

  return {
    options: {
      mode,
      plugins: [] as any[],
      module: {rules: [] as any[]}
    },
    hooks: {beforeRun}
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

    // Stylelint plugins appended
    expect(compiler.options.plugins.length).toBeGreaterThanOrEqual(1)
    // Loaders from both content + html plus conditional sass/less rules
    expect(compiler.options.module.rules.length).toBeGreaterThanOrEqual(
      mockedContentLoaders.length + mockedHtmlLoaders.length
    )
  })

  it('defers configuration to beforeRun in production mode', async () => {
    const compiler = createCompiler('production')
    const plugin = new CssPlugin({manifestPath: '/project/manifest.json'})

    await plugin.apply(compiler)

    expect(compiler.hooks.beforeRun.tapPromise).toHaveBeenCalled()

    // Simulate Rspack calling the hook
    await (compiler.hooks.beforeRun as any)._cb()

    expect(compiler.options.plugins.length).toBeGreaterThanOrEqual(1)
    expect(compiler.options.module.rules.length).toBeGreaterThanOrEqual(
      mockedContentLoaders.length + mockedHtmlLoaders.length
    )
  })
})
