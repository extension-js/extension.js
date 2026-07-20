import * as path from 'node:path'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const mockedReact = {
  alias: {
    react$: '/x/react',
    'react-dom$': '/x/react-dom',
    'react/jsx-runtime': '/x/react/jsx-runtime',
    'react/jsx-dev-runtime': '/x/react/jsx-dev-runtime'
  },
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
const transpilePackagesMocks = vi.hoisted(() => ({
  resolveTranspilePackageDirs: vi.fn(() => []),
  isSubPath: vi.fn(
    (resourcePath: string, directoryPath: string) =>
      resourcePath === directoryPath ||
      resourcePath.startsWith(`${directoryPath}/`)
  )
}))
const projectFilesMocks = vi.hoisted(() => ({
  manifest: {} as Record<string, any>,
  htmlFiles: {} as Record<string, string>,
  manifestHtmlFields: {} as Record<string, string | undefined>
}))

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
  ensureTypeScriptConfig: vi.fn(),
  getUserTypeScriptConfigFile: vi.fn(() => '/project/tsconfig.json')
}))
vi.mock('../../lib/transpile-packages', () => ({
  resolveTranspilePackageDirs:
    transpilePackagesMocks.resolveTranspilePackageDirs,
  isSubPath: transpilePackagesMocks.isSubPath
}))
// The manifest-fields package is externalized CJS (the fs mock below cannot
// reach it), so stub it at the module boundary instead
vi.mock('browser-extension-manifest-fields', () => ({
  getManifestFieldsData: vi.fn(() => ({
    html: projectFilesMocks.manifestHtmlFields
  })),
  filterKeysForThisBrowser: vi.fn((manifest: any) => manifest)
}))
vi.mock('../../plugin-special-folders/get-data', () => ({
  getSpecialFoldersDataForCompiler: vi.fn(() => ({pages: {}, scripts: {}}))
}))

// Mock manifest and page-HTML reads inside fs.readFileSync
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    readFileSync: vi.fn((filePath: any) => {
      if (String(filePath).endsWith('manifest.json')) {
        return JSON.stringify(projectFilesMocks.manifest)
      }
      if (projectFilesMocks.htmlFiles[String(filePath)] !== undefined) {
        return projectFilesMocks.htmlFiles[String(filePath)]
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
  const watchRun: any = {
    tapPromise: vi.fn((_name: string, cb: () => Promise<void>) => {
      ;(watchRun as any)._cb = cb
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
    hooks: {beforeRun, watchRun}
  } as any
}

describe('JsFrameworksPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transpilePackagesMocks.resolveTranspilePackageDirs.mockReturnValue([])
    projectFilesMocks.manifest = {
      minimum_chrome_version: '120',
      browser_specific_settings: {gecko: {strict_min_version: '118.0'}}
    }
    projectFilesMocks.htmlFiles = {}
    projectFilesMocks.manifestHtmlFields = {}
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

  it('defers configuration to beforeRun in production and keeps SWC minify off', async () => {
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
    // Regression: keep SWC minify disabled in production so magic comments
    // (e.g. webpackIgnore/rspackIgnore) are preserved for bundler parsing.
    expect(swcRule?.use?.options?.minify).toBe(false)
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

  it('includes transpile package directories and keeps them out of node_modules exclusion', async () => {
    transpilePackagesMocks.resolveTranspilePackageDirs.mockReturnValue([
      '/project/node_modules/@workspace/ui'
    ])
    const compiler = createCompiler('development')
    const plugin = new JsFrameworksPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'development',
      transpilePackages: ['@workspace/ui']
    })

    await plugin.apply(compiler)

    const swcRule = compiler.options.module.rules.find(
      (rule: any) =>
        Array.isArray(rule?.include) &&
        rule?.issuerLayer?.not === 'extensionjs-content-script'
    )
    expect(swcRule.include).toContain('/project/node_modules/@workspace/ui')

    const excludeFn = swcRule.exclude?.[0]
    expect(typeof excludeFn).toBe('function')
    expect(
      excludeFn('/project/node_modules/@workspace/ui/src/button.tsx')
    ).toBe(false)
    expect(excludeFn('/project/node_modules/other-lib/index.js')).toBe(true)
  })

  it('leaves scripts as javascript/auto unless the platform declares a module', async () => {
    const compiler = createCompiler('development')
    const plugin = new JsFrameworksPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'development'
    })

    await plugin.apply(compiler)

    // Browsers load plain `<script src>` page scripts and classic workers as
    // sloppy classic scripts; forcing every non-content-script file to
    // strict ESM rejected Chrome-valid extensions (G20). The type must be an
    // EXPLICIT javascript/auto: left implicit, rspack infers it from the
    // nearest package.json `"type"` field, which Chrome never reads (G24,
    // a `"type": "commonjs"` project broke its own module service worker).
    const nonContentRule = compiler.options.module.rules.find(
      (rule: any) => rule?.issuerLayer?.not === 'extensionjs-content-script'
    )
    expect(nonContentRule?.type).toBe('javascript/auto')

    // Content-script rules must NOT be forced esm. They are injected as
    // classic scripts.
    const contentRules = compiler.options.module.rules.filter(
      (rule: any) => rule?.layer === 'extensionjs-content-script'
    )
    expect(contentRules.length).toBeGreaterThan(0)
    for (const rule of contentRules) {
      expect((rule as any).type).toBe('javascript/auto')
    }

    // With nothing platform-declared as a module, no ESM marker rule exists.
    const esmRules = compiler.options.module.rules.filter(
      (rule: any) => rule?.type === 'javascript/esm'
    )
    expect(esmRules.length).toBe(0)
  })

  it('marks a "type": "module" service worker as javascript/esm', async () => {
    projectFilesMocks.manifest = {
      background: {service_worker: 'sw.js', type: 'module'}
    }
    const compiler = createCompiler('development')
    const plugin = new JsFrameworksPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'development'
    })

    await plugin.apply(compiler)

    const esmRule = compiler.options.module.rules.find(
      (rule: any) => rule?.type === 'javascript/esm'
    )
    expect(esmRule).toBeDefined()
    // The rule must match every absolute form of the same file. On Windows
    // these disagree, `path.normalize` keeps a drive-less `\project\sw.js`
    // while `path.resolve` (the shape rspack reports) yields
    // `D:\project\sw.js`, so probing both keeps set-vs-probe form drift from
    // passing on POSIX CI and failing only on the Windows runner.
    expect(esmRule.include(path.normalize('/project/sw.js'))).toBe(true)
    expect(esmRule.include(path.resolve('/project/sw.js'))).toBe(true)
    expect(esmRule.include('/project/./sw.js')).toBe(true)
    expect(esmRule.include(path.normalize('/project/other.js'))).toBe(false)
    expect(esmRule.include(path.resolve('/project/other.js'))).toBe(false)
  })

  it('recognizes a manifest content script as classic in every absolute path form', async () => {
    projectFilesMocks.manifest = {
      background: {service_worker: 'sw.js', type: 'module'},
      content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
    }
    const compiler = createCompiler('development')
    const plugin = new JsFrameworksPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'development'
    })

    await plugin.apply(compiler)

    const esmRule = compiler.options.module.rules.find(
      (rule: any) => rule?.type === 'javascript/esm'
    )
    expect(esmRule).toBeDefined()
    // The ESM marker rule excludes content-script files via the shared
    // content-like matcher. Content-script paths are stored resolved
    // (drive-lettered on Windows) while rspack may probe with either form.
    // The matcher must recognize all of them or the content-script instance
    // gets force-marked ESM on exactly one platform.
    const isContentLike = (esmRule as any).exclude[0]
    expect(isContentLike(path.normalize('/project/content.js'))).toBe(true)
    expect(isContentLike(path.resolve('/project/content.js'))).toBe(true)
    expect(isContentLike(path.resolve('/project/sw.js'))).toBe(false)
  })

  it('does not mark a classic (no "type") service worker as ESM', async () => {
    projectFilesMocks.manifest = {
      background: {service_worker: 'sw.js'}
    }
    const compiler = createCompiler('development')
    const plugin = new JsFrameworksPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'development'
    })

    await plugin.apply(compiler)

    const esmRules = compiler.options.module.rules.filter(
      (rule: any) => rule?.type === 'javascript/esm'
    )
    expect(esmRules.length).toBe(0)
  })

  it('marks only <script type="module"> HTML page scripts as ESM', async () => {
    projectFilesMocks.manifest = {action: {default_popup: 'popup.html'}}
    projectFilesMocks.manifestHtmlFields = {
      'action/default_popup': '/project/popup.html'
    }
    projectFilesMocks.htmlFiles['/project/popup.html'] = [
      '<html><body>',
      '<script type="module" src="./main.js"></script>',
      '<script src="./classic.js"></script>',
      '</body></html>'
    ].join('')

    const compiler = createCompiler('development')
    const plugin = new JsFrameworksPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'development'
    })

    await plugin.apply(compiler)

    const esmRule = compiler.options.module.rules.find(
      (rule: any) => rule?.type === 'javascript/esm'
    )
    expect(esmRule).toBeDefined()
    // Probe the normalized AND resolved forms: HTML-derived module paths are
    // built with `path.join` (drive-less on Windows) while rspack reports the
    // resolved, drive-lettered form, so matching must be form-insensitive.
    expect(esmRule.include(path.normalize('/project/main.js'))).toBe(true)
    expect(esmRule.include(path.resolve('/project/main.js'))).toBe(true)
    // A plain <script src> is a classic script to the browser, never ESM.
    expect(esmRule.include(path.normalize('/project/classic.js'))).toBe(false)
    expect(esmRule.include(path.resolve('/project/classic.js'))).toBe(false)
  })

  it('auto-transpiles workspace packages even without explicit transpilePackages config', async () => {
    transpilePackagesMocks.resolveTranspilePackageDirs.mockReturnValue([
      '/project/node_modules/@workspace/ui'
    ])
    const compiler = createCompiler('development')
    const plugin = new JsFrameworksPlugin({
      manifestPath: '/project/manifest.json',
      mode: 'development'
    })

    await plugin.apply(compiler)

    const swcRule = compiler.options.module.rules.find(
      (rule: any) =>
        Array.isArray(rule?.include) &&
        rule?.issuerLayer?.not === 'extensionjs-content-script'
    )
    expect(swcRule.include).toContain('/project/node_modules/@workspace/ui')
  })
})
