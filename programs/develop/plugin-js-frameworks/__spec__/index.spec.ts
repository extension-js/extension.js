import {createRequire} from 'node:module'
import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../../plugin-web-extension/feature-scripts/contracts'
import {JsFrameworksPlugin} from '../index'
import {
  callable,
  configure,
  fakePackage,
  type LooseRule,
  loaderOf,
  MANIFEST,
  makeProject,
  rulesOf,
  swcOptionsFor,
  swcRules
} from './project-fixture'

// The same resolution the plugin does for a package the fixture lacks.
const fromDevelop = createRequire(path.join(__dirname, '..', '..', 'x.js'))

function reactProject(extra: Record<string, string | object> = {}) {
  const root = makeProject({
    'package.json': {dependencies: {react: '19.0.0', 'react-dom': '19.0.0'}},
    'manifest.json': MANIFEST,
    ...extra
  })

  fakePackage(
    root,
    'react',
    {version: '19.0.0', main: 'index.js'},
    {'index.js': '', 'jsx-runtime.js': '', 'jsx-dev-runtime.js': ''}
  )

  fakePackage(
    root,
    'react-dom',
    {version: '19.0.0', main: 'index.js'},
    {'index.js': '', 'client.js': ''}
  )

  return root
}

function vueProject(extra: Record<string, string | object> = {}) {
  const root = makeProject({
    'package.json': {dependencies: {vue: '3.5.0'}},
    'manifest.json': MANIFEST,
    ...extra
  })

  fakePackage(
    root,
    'vue',
    {version: '3.5.0', main: 'index.js', module: 'dist/vue.runtime.esm.js'},
    {'index.js': '', 'dist/vue.runtime.esm.js': ''}
  )

  return root
}

const isVueLoaderRule = (rule: LooseRule) =>
  rule.test !== undefined && /[\\/]vue-loader[\\/]/.test(loaderOf(rule))

describe('JsFrameworksPlugin aliases and framework rules', () => {
  it('aliases React to the project copy and patches the refresh loader out of content scripts', async () => {
    const root = reactProject()
    const compiler = await configure(root)
    const modules = path.join(root, 'node_modules')

    expect(compiler.options.resolve.alias).toMatchObject({
      react$: path.join(modules, 'react', 'index.js'),
      'react-dom$': path.join(modules, 'react-dom', 'index.js'),
      'react-dom/client': path.join(modules, 'react-dom', 'client.js'),
      'react/jsx-runtime': path.join(modules, 'react', 'jsx-runtime.js'),
      'react/jsx-dev-runtime': path.join(modules, 'react', 'jsx-dev-runtime.js')
    })

    const refreshRules = rulesOf(compiler).filter(
      (rule) => rule.use === 'builtin:react-refresh-loader'
    )

    expect(refreshRules).toHaveLength(1)
    expect(refreshRules[0].issuerLayer).toEqual({
      not: EXTENSIONJS_CONTENT_SCRIPT_LAYER
    })
  })

  it('names the JSX runtime of the installed framework in every SWC rule', async () => {
    const cases = [
      [{react: '19.0.0'}, 'react'],
      [{preact: '10.0.0'}, 'preact'],
      [{vue: '3.5.0'}, 'vue'],
      [{preact: '10.0.0', react: '19.0.0'}, 'react'],
      [{}, 'react']
    ] as const

    for (const [dependencies, importSource] of cases) {
      const root = makeProject({
        'package.json': {dependencies},
        'manifest.json': MANIFEST
      })

      if ('vue' in dependencies) {
        fakePackage(
          root,
          'vue',
          {version: '3.5.0', main: 'index.js'},
          {
            'index.js': ''
          }
        )
      }

      const compiler = await configure(root)

      for (const rule of swcRules(compiler).all) {
        expect(
          swcOptionsFor(rule, '/x/app.tsx').jsc.transform.react.importSource
        ).toBe(importSource)
      }
    }
  })

  it('reads JSX in a plain .js file only when a JSX framework is installed', async () => {
    const plain = makeProject({
      'package.json': {dependencies: {}},
      'manifest.json': MANIFEST
    })
    const react = reactProject()

    const plainRule = swcRules(await configure(plain)).pages
    const reactRule = swcRules(await configure(react)).pages

    expect(swcOptionsFor(plainRule, '/x/a.js').jsc.parser).toEqual({
      syntax: 'ecmascript',
      jsx: false,
      dynamicImport: true
    })

    expect(swcOptionsFor(reactRule, '/x/a.js').jsc.parser).toEqual({
      syntax: 'ecmascript',
      jsx: true,
      dynamicImport: true
    })
  })

  it('adds the Vue rule with the loader from Extension.js and applies VueLoaderPlugin', async () => {
    const root = vueProject()
    const compiler = await configure(root)
    const vueRules = rulesOf(compiler).filter(isVueLoaderRule)

    expect(vueRules).toHaveLength(1)
    expect(String(vueRules[0].test)).toBe(String(/\.vue$/))
    // The plugin's own pitcher rule is how VueLoaderPlugin marks itself applied.
    expect(
      rulesOf(compiler).some((rule) =>
        /[\\/]vue-loader[\\/]dist[\\/]pitcher/.test(String(rule.loader))
      )
    ).toBe(true)

    expect(compiler.options.resolve.alias).toMatchObject({
      vue$: path.join(root, 'node_modules', 'vue', 'dist', 'vue.runtime.esm.js')
    })
  })

  it('adds the Svelte rules and the .svelte extension', async () => {
    const root = makeProject({
      'package.json': {dependencies: {svelte: '99.0.0'}},
      'manifest.json': MANIFEST
    })
    const compiler = await configure(root)
    const svelteLoader = fromDevelop.resolve('svelte-loader')
    const svelteRule = rulesOf(compiler).find((rule) =>
      (rule.test as RegExp | undefined)?.test?.('/x/App.svelte')
    )

    expect((svelteRule?.use as {loader: string}).loader).toBe(svelteLoader)
    expect(compiler.options.resolve.extensions?.[0]).toBe('.svelte')
  })
})

describe('JsFrameworksPlugin SWC rules', () => {
  it('picks the parser from the extension and the targets from the build engine', async () => {
    const root = makeProject({
      'package.json': {devDependencies: {typescript: '5.0.0'}},
      'tsconfig.json': {},
      'manifest.json': {
        ...MANIFEST,
        minimum_chrome_version: '120',
        browser_specific_settings: {gecko: {strict_min_version: '118.0'}}
      }
    })
    const {pages} = swcRules(await configure(root))
    const parser = (file: string) => swcOptionsFor(pages, file).jsc.parser

    // A chrome build follows only the chrome floor: the gecko one is Firefox's.
    expect(swcOptionsFor(pages, '/x/a.ts').env.targets).toEqual([
      'chrome >= 120'
    ])

    expect(parser('/x/a.ts')).toEqual({
      syntax: 'typescript',
      tsx: false,
      dynamicImport: true
    })

    expect(parser('/x/helper.cts')).toEqual(parser('/x/a.ts'))
    expect(parser('/x/a.mts')).toEqual(parser('/x/a.ts'))
    expect(parser('/x/popup.tsx')).toEqual({
      syntax: 'typescript',
      tsx: true,
      dynamicImport: true
    })

    expect(parser('/x/popup.jsx')).toEqual({
      syntax: 'ecmascript',
      jsx: true,
      dynamicImport: true
    })

    expect(pages?.test).toEqual(/\.(js|cjs|mjs|jsx|mjsx|ts|mts|cts|tsx|mtsx)$/)
  })

  it('points resolve.tsConfig at tsconfig.json, or jsconfig.json in a JavaScript project', async () => {
    const ts = makeProject({
      'package.json': {},
      'tsconfig.json': {},
      'jsconfig.json': {},
      'manifest.json': MANIFEST
    })
    const js = makeProject({
      'package.json': {},
      'jsconfig.json': {},
      'manifest.json': MANIFEST
    })
    const none = makeProject({'package.json': {}, 'manifest.json': MANIFEST})

    expect((await configure(ts)).options.resolve.tsConfig).toEqual({
      configFile: path.join(ts, 'tsconfig.json')
    })

    expect((await configure(js)).options.resolve.tsConfig).toEqual({
      configFile: path.join(js, 'jsconfig.json')
    })

    expect((await configure(none)).options.resolve.tsConfig).toBeUndefined()
  })

  it('turns SWC sourcemaps on in development unless devtool is false', async () => {
    const root = makeProject({'package.json': {}, 'manifest.json': MANIFEST})

    for (const [devtool, expected] of [
      [undefined, true],
      [false, false],
      ['source-map', true]
    ] as const) {
      const {pages} = swcRules(await configure(root, {devtool}))
      expect(swcOptionsFor(pages, '/x/a.js').sourceMap).toBe(expected)
    }
  })

  it('turns SWC sourcemaps on in production only when devtool asks', async () => {
    const root = makeProject({'package.json': {}, 'manifest.json': MANIFEST})

    for (const [devtool, expected] of [
      [undefined, false],
      ['hidden-source-map', true]
    ] as const) {
      const options = {mode: 'production', devtool} as const
      const {pages} = swcRules(await configure(root, options))
      expect(swcOptionsFor(pages, '/x/a.js').sourceMap).toBe(expected)
    }
  })

  it('defers configuration to beforeRun in production and leaves SWC minify at its default', async () => {
    const root = makeProject({'package.json': {}, 'manifest.json': MANIFEST})
    const compiler = rspack({
      mode: 'production',
      context: root,
      entry: {},
      output: {path: path.join(root, 'dist')}
    })

    await new JsFrameworksPlugin({
      manifestPath: path.join(root, 'manifest.json'),
      mode: 'production'
    }).apply(compiler)

    expect(swcRules(compiler).all).toHaveLength(0)

    await compiler.hooks.beforeRun.promise(compiler)

    const {pages} = swcRules(compiler)
    // SWC's own default is off, which keeps magic comments for rspack.
    expect(swcOptionsFor(pages, '/x/a.js').minify).toBeUndefined()
    expect(swcOptionsFor(pages, '/x/a.js').jsc.transform.react).toEqual({
      runtime: 'automatic',
      importSource: 'react',
      refresh: false
    })
  })

  it('gates a one-shot development build on the same configure promise as watch', async () => {
    const root = makeProject({'package.json': {}, 'manifest.json': MANIFEST})
    const compiler = await configure(root)
    const ours = (taps: Array<{name: string}>) =>
      taps.filter((tap) => tap.name === JsFrameworksPlugin.name)

    expect(ours(compiler.hooks.beforeRun.taps)).toHaveLength(1)
    expect(ours(compiler.hooks.watchRun.taps)).toHaveLength(1)

    const rulesBefore = rulesOf(compiler).length
    await compiler.hooks.beforeRun.promise(compiler)
    await compiler.hooks.watchRun.promise(compiler)

    // One configure pass: neither hook runs it again.
    expect(rulesOf(compiler).length).toBe(rulesBefore)
    expect(swcRules(compiler).all).toHaveLength(3)
  })
})

describe('JsFrameworksPlugin and user rules', () => {
  it('merges into the vue-loader rule the user already configured instead of adding a second', async () => {
    const root = vueProject()
    const isCustomElement = (tag: string) => tag.startsWith('ion-')
    const compiler = await configure(root, {
      rules: [
        {
          test: /\.vue$/,
          loader: fromDevelop.resolve('vue-loader'),
          options: {compilerOptions: {isCustomElement}}
        }
      ]
    })
    const vueRules = rulesOf(compiler).filter(isVueLoaderRule)

    expect(vueRules).toHaveLength(1)
    // VueLoaderPlugin moves loader and options into `use`.
    const [use] = vueRules[0].use as Array<{options: Record<string, unknown>}>
    expect(use.options).toEqual({
      experimentalInlineMatchResource: true,
      compilerOptions: {isCustomElement}
    })
  })
})

describe('JsFrameworksPlugin transpiled packages', () => {
  function workspaceProject(dependency: string) {
    const root = makeProject({
      'package.json': {
        dependencies: {
          '@workspace/ui': dependency,
          vue: '3.5.0',
          'solid-js': '1'
        }
      },
      'manifest.json': MANIFEST
    })

    fakePackage(root, '@workspace/ui', {main: 'index.js'}, {'index.js': ''})
    fakePackage(
      root,
      'vue',
      {version: '3.5.0', main: 'index.js'},
      {
        'index.js': ''
      }
    )

    return root
  }

  const uiFile = (root: string) =>
    path.join(root, 'node_modules', '@workspace', 'ui', 'src', 'button.tsx')
  const otherFile = (root: string) =>
    path.join(root, 'node_modules', 'other-lib', 'index.js')

  it('compiles a package named in transpilePackages like a project file, in every compiling rule', async () => {
    const root = workspaceProject('1.0.0')
    const compiler = await configure(root, {
      transpilePackages: ['@workspace/ui']
    })
    const {pages} = swcRules(compiler)

    expect(pages?.include).toBeUndefined()

    const excludes = [
      callable((pages?.exclude as unknown[])[0]),
      callable(rulesOf(compiler).find(isVueLoaderRule)?.exclude),
      ...rulesOf(compiler)
        .filter(
          (rule) =>
            rule.test !== undefined &&
            /babel-loader|solid-jsx-gate/.test(loaderOf(rule))
        )
        .map((rule) => callable(rule.exclude))
    ]

    // One SWC page rule, one Vue rule and Solid's three Babel rules.
    expect(excludes).toHaveLength(5)

    for (const exclude of excludes) {
      expect(exclude(uiFile(root))).toBe(false)
      expect(exclude(otherFile(root))).toBe(true)
    }
  })

  it('compiles a workspace: dependency like a project file without transpilePackages', async () => {
    const root = workspaceProject('workspace:*')
    const {pages} = swcRules(await configure(root))
    const exclude = callable((pages?.exclude as unknown[])[0])

    expect(exclude(uiFile(root))).toBe(false)
    expect(exclude(otherFile(root))).toBe(true)
  })
})

describe('JsFrameworksPlugin script kinds', () => {
  it('leaves scripts as javascript/auto unless the platform declares a module', async () => {
    const root = makeProject({
      'package.json': {},
      'manifest.json': {...MANIFEST, background: {service_worker: 'sw.js'}}
    })
    const rules = swcRules(await configure(root))

    expect(rules.pages?.type).toBe('javascript/auto')
    expect(rules.contentByPath?.type).toBe('javascript/auto')
    expect(rules.contentByIssuer?.type).toBe('javascript/auto')
    expect(rules.modules).toBeUndefined()
    expect(swcOptionsFor(rules.pages, '/x/a.js').isModule).toBe('unknown')
  })

  it('compiles a "type": "module" service worker as javascript/esm, in every path spelling', async () => {
    const root = makeProject({
      'package.json': {},
      'manifest.json': {
        ...MANIFEST,
        background: {service_worker: 'sw.js', type: 'module'}
      }
    })
    const {modules, pages} = swcRules(await configure(root))
    const include = callable(modules?.include)

    expect(swcOptionsFor(modules, '/x/sw.js').isModule).toBe(true)
    expect(include(path.join(root, 'sw.js'))).toBe(true)
    expect(include(`${root}/./sw.js`)).toBe(true)
    expect(include(path.join(root, 'other.js'))).toBe(false)
    // The general rule steps aside for it.
    expect(
      callable((pages?.exclude as unknown[])[2])(path.join(root, 'sw.js'))
    ).toBe(true)
  })

  it('keeps a manifest content script classic even when the service worker is a module', async () => {
    const root = makeProject({
      'package.json': {},
      'manifest.json': {
        ...MANIFEST,
        background: {service_worker: 'sw.js', type: 'module'},
        content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
      }
    })
    const {modules, contentByPath} = swcRules(await configure(root))
    const isContentLike = callable((modules?.exclude as unknown[])[0])

    expect(isContentLike(path.join(root, 'content.js'))).toBe(true)
    expect(isContentLike(`${root}/./content.js`)).toBe(true)
    expect(isContentLike(path.join(root, 'sw.js'))).toBe(false)
    expect(
      callable(contentByPath?.include)(path.join(root, 'content.js'))
    ).toBe(true)

    expect(swcOptionsFor(contentByPath, '/x/a.js')).toMatchObject({
      isModule: 'unknown',
      jsc: {transform: {react: {refresh: false}}}
    })
  })

  it('marks only <script type="module"> page scripts as ESM', async () => {
    const root = makeProject({
      'package.json': {},
      'manifest.json': {...MANIFEST, action: {default_popup: 'popup.html'}},
      'popup.html':
        '<html><body><script type="module" src="./main.js"></script>' +
        '<script src="./classic.js"></script></body></html>',
      'main.js': '',
      'classic.js': ''
    })
    const include = callable(swcRules(await configure(root)).modules?.include)

    expect(include(path.join(root, 'main.js'))).toBe(true)
    expect(include(path.join(root, 'classic.js'))).toBe(false)
  })
})
