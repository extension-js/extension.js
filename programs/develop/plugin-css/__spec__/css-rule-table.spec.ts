import {createRequire} from 'node:module'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {resolveDevelopDistFile} from '../../lib/develop-context'
import {extensionSchemeFor} from '../../lib/extension-base-from-stack'
import {NOT_RAW_RESOURCE_QUERY} from '../../lib/resource-query'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER as LAYER} from '../../plugin-web-extension/feature-scripts/contracts'
import {extensionBaseAttributeFor} from '../../plugin-web-extension/feature-scripts/scripts-lib/taken-extension-base'
import {commonStyleLoaders} from '../common-style-loaders'
import {
  SFC_INLINE_STYLE_BLOCK_QUERY,
  SFC_MODULE_STYLE_BLOCK_QUERY,
  SFC_STYLE_BLOCK_QUERY,
  SVELTE_STYLE_BLOCK_TEST
} from '../css-lib/sfc-style-block'
import {maybeUseLess} from '../css-tools/less'
import {maybeUseSass} from '../css-tools/sass'
import {CssPlugin} from '../index'
import {
  closeCompiler,
  configureCss,
  createCompiler,
  cssProjects,
  type Mode
} from './helpers/css-project'

const makeProject = cssProjects()
const developRequire = createRequire(
  path.join(__dirname, '..', '..', 'package.json')
)
const dist = resolveDevelopDistFile

type Browser = 'chrome' | 'firefox'
type Item = {loader: string; options?: Record<string, unknown>}

// Written out by hand from what each language and surface must get, so a
// change to the rule builder shows up here as a one-line difference.
function expectedRules(
  root: string,
  mode: Mode,
  tools: {postcss?: Item; sass?: Item; less?: Item},
  browser: Browser = 'chrome'
) {
  const manifestPath = path.join(root, 'manifest.json')
  const gecko = browser === 'firefox'
  const base = {
    baseAttribute: extensionBaseAttributeFor(manifestPath, browser),
    baseScheme: extensionSchemeFor(browser)
  }
  const publicUrls = {
    loader: dist('public-css-url-loader'),
    options: {manifestPath, projectPath: root}
  }
  const inlineUrls = {
    loader: dist('dead-css-url-loader'),
    options: {
      manifestPath,
      projectPath: root,
      ...(gecko ? {gecko} : {}),
      ...base
    }
  }
  // The same loader a second time, ahead of PostCSS: it brings in the rules
  // of each sheet an inlined sheet imports.
  const inlineImports = {
    loader: dist('dead-css-url-loader'),
    options: {manifestPath, projectPath: root, inlineImports: true}
  }
  const late = {loader: dist('late-css-import-loader')}
  const guard = {loader: dist('css-parse-guard-loader')}
  const passthrough = {
    loader: dist('preprocessor-passthrough-loader'),
    // The install command is asked for only when a warning prints.
    options: {install: expect.any(Function)}
  }
  const post = tools.postcss ? [guard, tools.postcss] : []

  // The loader that reads a sheet of each language first, if any.
  const languages = [
    {test: /\.module\.css$/, module: true, first: []},
    {test: /\.css$/, exclude: /\.module\.css$/, module: false, first: []},
    {
      test: /\.(sass|scss)$/,
      exclude: /\.module\.(sass|scss)$/,
      module: false,
      first: [tools.sass ?? passthrough]
    },
    {
      test: /\.module\.(sass|scss)$/,
      module: true,
      first: [tools.sass ?? passthrough]
    },
    {
      test: /\.less$/,
      exclude: /\.module\.less$/,
      module: false,
      first: [tools.less ?? passthrough]
    },
    {
      test: /\.module\.less$/,
      module: true,
      first: [tools.less ?? passthrough]
    }
  ]

  const sheet = (chain: Item[]) => [
    publicUrls,
    late,
    ...(chain.includes(guard) ? chain : [guard, ...chain])
  ]

  const surface = (
    where: Record<string, unknown>,
    inlined: boolean
  ): Array<Record<string, unknown>> =>
    languages.map(({test, exclude, module, first}) => {
      const emitsSheet = module || !inlined

      return {
        test,
        ...(exclude ? {exclude} : {}),
        type: module ? 'css/module' : inlined ? 'javascript/auto' : 'css',
        ...(emitsSheet ? {sideEffects: true} : {}),
        ...where,
        resourceQuery: NOT_RAW_RESOURCE_QUERY,
        use: emitsSheet
          ? sheet([...post, ...first])
          : [inlineUrls, ...post, inlineImports, ...first]
      }
    })

  const sfcOptions = {
    manifestPath,
    projectPath: root,
    ...(gecko ? {gecko} : {}),
    ...base
  }
  const sfcLoader = dist('sfc-style-block-loader')

  return [
    // A sheet a content script imports.
    ...surface(
      {issuer: /./, issuerLayer: LAYER, dependency: {not: 'css-import'}},
      true
    ),
    // A sheet a page links.
    ...surface({issuerLayer: {not: LAYER}}, false),
    // A sheet the manifest lists for a content script.
    ...surface({issuer: {not: /./}, issuerLayer: LAYER}, false),
    // A sheet such a listed sheet brings in with @import.
    ...surface(
      {issuer: /./, issuerLayer: LAYER, dependency: 'css-import'},
      false
    ),
    {
      enforce: 'post',
      issuerLayer: LAYER,
      resourceQuery: SFC_STYLE_BLOCK_QUERY,
      sideEffects: true,
      loader: sfcLoader,
      options: sfcOptions
    },
    {
      enforce: 'post',
      issuerLayer: LAYER,
      test: SVELTE_STYLE_BLOCK_TEST,
      sideEffects: true,
      loader: sfcLoader,
      options: sfcOptions
    },
    {
      enforce: 'post',
      issuerLayer: {not: LAYER},
      resourceQuery: SFC_INLINE_STYLE_BLOCK_QUERY,
      loader: sfcLoader,
      options: sfcOptions
    },
    {
      test: /\.(css|sass|scss|less)$/,
      resourceQuery: SFC_MODULE_STYLE_BLOCK_QUERY,
      type: 'javascript/auto'
    },
    {
      enforce: 'post',
      issuerLayer: {not: LAYER},
      resourceQuery: SFC_MODULE_STYLE_BLOCK_QUERY,
      loader: sfcLoader,
      options: sfcOptions
    },
    {
      enforce: 'pre',
      test: /\.(js|cjs|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
      exclude: [/([\\/])node_modules\1/],
      issuerLayer: LAYER,
      resourceQuery: NOT_RAW_RESOURCE_QUERY,
      loader: dist('unplaced-style-import-loader'),
      options: {projectPath: root, declaredEntries: []}
    },
    {
      test: /\.(css|sass|scss|less)$/,
      resourceQuery: /(\?|&)inline(&|$)/,
      type: 'asset/source'
    }
  ]
}

const MODES: Mode[] = ['development', 'production']

describe('the rules CssPlugin adds, per language and surface', () => {
  it.each(MODES)('%s, plain CSS: no preprocessor, no PostCSS', async (mode) => {
    const root = makeProject({})

    expect(await configureCss(root, mode)).toEqual(
      expectedRules(root, mode, {})
    )
  })

  it.each(
    MODES
  )('%s, a PostCSS config: its loader behind the parse guard', async (mode) => {
    const root = makeProject({
      'postcss.config.cjs': "module.exports = {plugins: [{postcssPlugin: 'p'}]}"
    })
    const postcss = {
      loader: developRequire.resolve('postcss-loader'),
      options: {
        postcssOptions: {
          cwd: root,
          config: false,
          plugins: [
            {postcssPlugin: 'p'},
            // Names the config files as dependencies of every sheet.
            expect.objectContaining({
              postcssPlugin: 'extension-js-postcss-setup-files'
            })
          ]
        },
        sourceMap: mode === 'development'
      }
    }

    expect(await configureCss(root, mode)).toEqual(
      expectedRules(root, mode, {postcss})
    )
  })

  it.each(
    MODES
  )('%s, Sass and Less installed: each compiles its own files', async (mode) => {
    const root = makeProject({
      'package.json': JSON.stringify({
        name: 'css-fixture',
        devDependencies: {sass: '^1.0.0', less: '^4.0.0'}
      })
    })
    const sourceMap = mode === 'development'
    // The loaders are handed over as files, never as bare names.
    const sass = {
      loader: developRequire.resolve('sass-loader'),
      options: {
        sassOptions: {outputStyle: 'expanded'},
        implementation: developRequire('sass'),
        sourceMap
      }
    }
    const less = {
      loader: developRequire.resolve('less-loader'),
      options: {sourceMap}
    }

    expect(await configureCss(root, mode)).toEqual(
      expectedRules(root, mode, {sass, less})
    )
  })

  it('tells the inlining and component loaders of a Gecko build', async () => {
    const root = makeProject({})

    expect(await configureCss(root, 'production', 'firefox')).toEqual(
      expectedRules(root, 'production', {}, 'firefox')
    )
  })

  it('leaves no rule to a later compile in production until the build asks', async () => {
    const root = makeProject({})
    const compiler = createCompiler(root, 'production')

    try {
      await new CssPlugin({
        manifestPath: path.join(root, 'manifest.json')
      }).apply(compiler)

      expect(compiler.options.module.rules).toEqual([])

      await compiler.hooks.beforeRun.promise(compiler)
      expect(compiler.options.module.rules).toEqual(
        expectedRules(root, 'production', {})
      )
    } finally {
      await closeCompiler(compiler)
    }
  })

  it('names the CSS files after the chunk in both modes', async () => {
    for (const mode of MODES) {
      const root = makeProject({})
      const compiler = createCompiler(root, mode)

      try {
        await new CssPlugin({
          manifestPath: path.join(root, 'manifest.json')
        }).apply(compiler)

        await compiler.hooks.beforeRun.promise(compiler)

        expect([
          compiler.options.output.cssFilename,
          compiler.options.output.cssChunkFilename
        ]).toEqual(['[name].css', '[name].css'])
      } finally {
        await closeCompiler(compiler)
      }
    }
  })
})

describe('the stylesheet rules and a ?raw import', () => {
  it('leave a ?raw request to the file text', () => {
    expect(NOT_RAW_RESOURCE_QUERY.not[0].test('?raw')).toBe(true)
    expect(NOT_RAW_RESOURCE_QUERY.not[0].test('?url')).toBe(false)
  })
})

describe('the ?inline stylesheet rule', () => {
  it.each([
    ['?vue&type=style&index=0&id=x&inline&lang=css', true],
    ['?inline', true],
    ['?vue&type=style&index=0&id=x&lang=css', false],
    ['?no-inline-here=1', false],
    ['?inlineLimit=4096', false]
  ])('matches %s: %s', async (query, matches) => {
    const root = makeProject({})
    const rules = await configureCss(root, 'development')
    const inline = rules[rules.length - 1].resourceQuery as RegExp

    expect(inline.test(query)).toBe(matches)
  })
})

describe('commonStyleLoaders', () => {
  it('returns no loader for a project that uses no style tool', async () => {
    const root = makeProject({})

    expect(await commonStyleLoaders(root, {mode: 'development'})).toEqual([])
  })

  it.each(
    MODES
  )('adds the given loader with a %s source map setting', async (mode) => {
    const root = makeProject({})

    expect(
      await commonStyleLoaders(root, {
        mode,
        loader: 'some-loader',
        loaderOptions: {foo: true, sourceMap: 'overwritten'}
      })
    ).toEqual([
      {
        loader: 'some-loader',
        options: {foo: true, sourceMap: mode === 'development'}
      }
    ])
  })
})

describe('the preprocessor contracts', () => {
  it('resolve without a rule of their own when the project uses neither', async () => {
    const root = makeProject({})

    await expect(maybeUseSass(root)).resolves.toBeUndefined()
    await expect(maybeUseLess(root)).resolves.toBeUndefined()
  })
})
