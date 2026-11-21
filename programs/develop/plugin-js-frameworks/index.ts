//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler, RuleSetRule, SwcLoaderOptions} from '@rspack/core'
import {filterKeysForThisBrowser} from '../lib/manifest-utils'
import {debugLine, isDebug} from '../lib/messaging'
import {ensureOptionalPackageResolved} from '../lib/optional-deps-resolver'
import {type ParsedJson, parseJsonSafe} from '../lib/parse-json-safe'
import {toResourceKey} from '../lib/resource-path'
import {NOT_RAW_RESOURCE_QUERY, RAW_RESOURCE_QUERY} from '../lib/resource-query'
import {setupInOrder} from '../lib/setup-in-order'
import {scriptsFolderRoot} from '../lib/special-folders/folders-config'
import {resolveEngineTargets} from '../lib/swc-targets'
import {
  createNodeModulesExclude,
  resolveTranspilePackageDirs
} from '../lib/transpile-packages'
import {getUserTypeScriptConfigFile} from '../lib/user-tsconfig'
import {getSpecialFoldersDataForCompiler} from '../plugin-special-folders/get-data'
import {getAssetsFromHtml} from '../plugin-web-extension/feature-html/html-lib/utils'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../plugin-web-extension/feature-scripts/contracts'
import {htmlPageEntries} from '../plugin-web-extension/shared/html-page-entries'
import {getResolvedManifestFieldsData} from '../plugin-web-extension/shared/manifest-fields'
import type {DevOptions, Manifest, PluginInterface} from '../types'
import {
  type BabelFileKind,
  findProjectBabelConfig,
  projectBabelOptions
} from './js-frameworks-lib/babel-config'
import {
  getJsxImportSource,
  isUsingJsxFramework,
  swcParserForFile
} from './js-frameworks-lib/jsx-transform'
import * as messages from './js-frameworks-lib/messages'
import {createSessionNotices} from './js-frameworks-lib/session-notices'
import {readTransformFlags, swcDecoratorTransform} from './js-tools/decorators'
import {maybeUsePreact} from './js-tools/preact'
import {
  isUsingReact,
  maybeUseReact,
  resolveReactRefreshEntry
} from './js-tools/react'
import {maybeUseSolid} from './js-tools/solid'
import {maybeUseSvelte} from './js-tools/svelte'
import {
  ensureTypeScriptConfig,
  getUserJsConfigFile
} from './js-tools/typescript'
import {maybeUseVue} from './js-tools/vue'

// What a service worker or a background scripts list runs, at any depth. It
// has no component tree to refresh, so refresh code stays out of this layer.
export const EXTENSIONJS_BACKGROUND_LAYER = 'extensionjs-background'

// A .vue file, or a block vue-loader names after it (`Button.vue.ts`).
const VUE_BLOCK = /\.vue(\.[cm]?[jt]sx?)?$/

// User-authored and default webpack rules arrive in many shapes; this loose
// view names only the fields the merge/patch helpers probe.
interface LooseRuleUse {
  loader?: unknown
  options?: Record<string, unknown>
}

interface LooseRuleSetRule {
  test?: unknown
  loader?: unknown
  options?: Record<string, unknown>
  use?: LooseRuleUse | LooseRuleUse[]
  oneOf?: unknown
  rules?: unknown
  issuerLayer?: unknown
  [key: string]: unknown
}

export class JsFrameworksPlugin {
  public static readonly name: string = 'plugin-js-frameworks'
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  public readonly mode: DevOptions['mode']
  public readonly transpilePackages: string[]
  public readonly define: Record<string, unknown>
  // One plugin serves one compiler, so its once-only lines are that build's.
  private readonly notices = createSessionNotices()

  constructor(
    options: PluginInterface & {
      mode: DevOptions['mode']
      transpilePackages?: string[]
      // The project's `define` constants, so framework defaults step aside.
      define?: Record<string, unknown>
    }
  ) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.mode = options.mode
    this.transpilePackages = options.transpilePackages || []
    this.define = options.define || {}
  }

  private findVueLoaderRuleIndices(rules: LooseRuleSetRule[]): number[] {
    const indices: number[] = []

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]
      const testStr = String(rule?.test || '')
      const isVueTest =
        testStr.includes('\\.vue') ||
        testStr.includes('/.vue') ||
        testStr === '.vue'

      if (!isVueTest) continue

      const use = rule?.use
      const loader =
        rule?.loader ||
        (Array.isArray(use)
          ? use?.[0]?.loader
          : typeof use === 'object'
            ? use?.loader
            : undefined)
      const loaderStr = String(loader || '')

      // Only dedupe rules that actually use vue-loader; do not touch custom .vue pipelines.
      if (loaderStr.includes('vue-loader')) {
        indices.push(i)
      }
    }

    return indices
  }

  private mergeVueRule(
    userRule: LooseRuleSetRule,
    defaultRule: LooseRuleSetRule
  ): LooseRuleSetRule {
    const merged = {...userRule}

    // Normalize rule to either `loader` + `options` or `use`-based.
    // Prefer keeping the user's structure (and loader order) intact.
    if (merged.use) {
      if (Array.isArray(merged.use) && merged.use.length > 0) {
        const first = merged.use[0]
        merged.use = [
          {
            ...first,
            loader: first?.loader || defaultRule?.loader,
            options: {
              ...(defaultRule?.options || {}),
              ...(first?.options || {})
            }
          },
          ...merged.use.slice(1)
        ]
      } else if (typeof merged.use === 'object' && !Array.isArray(merged.use)) {
        const useObj = merged.use as LooseRuleUse
        merged.use = {
          ...useObj,
          loader: useObj?.loader || defaultRule?.loader,
          options: {
            ...(defaultRule?.options || {}),
            ...(useObj?.options || {})
          }
        }
      }

      return merged
    }

    merged.loader = merged.loader || defaultRule?.loader
    merged.options = {
      ...(defaultRule?.options || {}),
      ...(merged.options || {})
    }

    return merged
  }

  // The rules the refresh plugin adds while it is applied are the refresh
  // rules, whatever loader they name, and none may reach a content script.
  // Nor the background, which runs the same sources with nothing to refresh.
  private applyReactPlugins(
    compiler: Compiler,
    plugins: Array<{apply(compiler: Compiler): void}>
  ) {
    const before = new Set<unknown>(compiler.options.module.rules)

    for (const plugin of plugins) plugin.apply(compiler)

    for (const rule of compiler.options.module.rules) {
      if (!rule || typeof rule !== 'object' || before.has(rule)) continue

      rule.issuerLayer = {
        not: [EXTENSIONJS_CONTENT_SCRIPT_LAYER, EXTENSIONJS_BACKGROUND_LAYER]
      }
    }
  }

  private async configureOptions(compiler: Compiler) {
    const mode = compiler.options.mode || 'development'
    const projectPath = compiler.options.context as string
    const manifestDir = path.dirname(this.manifestPath)

    // Detection (isUsingTypeScript) is now pure, so the one-time tsconfig
    // setup/throw must be triggered explicitly at this build chokepoint
    ensureTypeScriptConfig(
      projectPath,
      {manifestPath: this.manifestPath, browser: this.browser},
      this.notices.typescript
    )

    // Computed before the framework integrations run: every compiling rule they
    // return needs the same carve-out, not just the swc rule below.
    const transpilePackageDirs = resolveTranspilePackageDirs(
      projectPath,
      this.transpilePackages
    ).filter((dir) => dir !== projectPath && dir !== manifestDir)
    const excludeNodeModules = createNodeModulesExclude(transpilePackageDirs)
    // A .vue file is source wherever it lives, so the script and template
    // blocks vue-loader splits out of one in a dependency compile too.
    const excludeScriptsInNodeModules = (resourcePath: string) =>
      !VUE_BLOCK.test(resourcePath) && excludeNodeModules(resourcePath)

    // The bundler resolves symlinks, so loader resource paths arrive as
    // realpaths while these dirs are the logical spellings (/tmp, /var,
    // pnpm links). Match both or the swc rule silently skips every source.
    const expandWithRealpaths = (dirs: string[]): string[] => {
      const out = new Set<string>()

      for (const dir of dirs) {
        if (!dir) continue

        out.add(dir)

        try {
          out.add(fs.realpathSync(dir))
        } catch {
          // Ignore
        }
      }

      return Array.from(out)
    }

    const addBothPathForms = (set: Set<string>, absPath: string) => {
      set.add(toResourceKey(absPath))

      try {
        set.add(toResourceKey(fs.realpathSync(absPath)))
      } catch {
        // Ignore
      }
    }

    // Every entry AND probe of these path sets goes through toResourceKey: mixing
    // path.resolve and path.normalize never matches on Windows (drive letter).
    const contentScriptLikePaths = new Set<string>()
    const scriptsRoot = scriptsFolderRoot(projectPath)
    const scriptsDirs = expandWithRealpaths(
      scriptsRoot ? [scriptsRoot] : []
    ).map(toResourceKey)

    const isfeatureScriptsContentLike = (resourcePath: string) => {
      const normalized = toResourceKey(resourcePath)

      if (contentScriptLikePaths.has(normalized)) {
        return true
      }

      return scriptsDirs.some((scriptsDir) => {
        const relToScripts = path.relative(scriptsDir, normalized)

        return (
          !!relToScripts &&
          !relToScripts.startsWith('..') &&
          !path.isAbsolute(relToScripts)
        )
      })
    }

    // Enable SWC sourcemaps whenever the build emits sourcemaps: dev defaults on
    // unless devtool is disabled; production only on devtool opt-in.
    const devtool = (compiler.options as {devtool?: unknown}).devtool
    const wantsSourceMaps =
      devtool !== false && (mode === 'development' || devtool != null)

    let manifest: Manifest = {}

    try {
      manifest = parseJsonSafe(fs.readFileSync(this.manifestPath, 'utf-8'))
    } catch {
      // Ignore
    }

    // A browser-prefixed key is the only spelling this target sees, so read
    // the resolved manifest here as the background block below already does.
    let browserManifest: Manifest = manifest

    try {
      browserManifest = filterKeysForThisBrowser(manifest, this.browser)
    } catch {
      // Ignore
    }

    const contentScripts = Array.isArray(browserManifest?.content_scripts)
      ? browserManifest.content_scripts
      : []

    for (const contentScript of contentScripts) {
      const jsList = Array.isArray(contentScript?.js) ? contentScript.js : []

      for (const jsFile of jsList) {
        addBothPathForms(
          contentScriptLikePaths,
          path.resolve(manifestDir, jsFile)
        )
      }
    }

    // Browsers parse a script as an ES module only where the platform declares it;
    // everything else loads classic, so only declared modules are force-marked ESM below.
    const platformModulePaths = new Set<string>()

    try {
      const background = browserManifest?.background

      if (
        background?.type === 'module' &&
        typeof background?.service_worker === 'string'
      ) {
        addBothPathForms(
          platformModulePaths,
          path.resolve(manifestDir, background.service_worker)
        )
      }

      // The same page list the HTML plugin compiles, so a module script on a
      // page only a script opens at runtime is marked ESM like a manifest one.
      const manifestFieldsData = getResolvedManifestFieldsData({
        manifestPath: this.manifestPath,
        browser: this.browser,
        projectPath
      })
      const htmlPages: Record<string, unknown> = htmlPageEntries({
        manifestPath: this.manifestPath,
        browser: this.browser,
        projectPath,
        mode: compiler.options?.mode,
        manifestHtml: manifestFieldsData.html,
        manifestScripts: manifestFieldsData.scripts,
        specialFolderPages: getSpecialFoldersDataForCompiler(compiler).pages
      })

      for (const htmlPage of Object.values(htmlPages)) {
        if (typeof htmlPage !== 'string') continue

        for (const moduleScript of getAssetsFromHtml(htmlPage)?.moduleJs ||
          []) {
          addBothPathForms(platformModulePaths, moduleScript)
        }
      }
    } catch {
      // Fail open: with no declared modules everything parses as
      // `javascript/auto`, and import/export files are still detected as ESM
    }

    const maybeInstallReact = await maybeUseReact(projectPath, {
      disableRefresh: mode !== 'development',
      notices: this.notices,
      // A custom exclude replaces the plugin's own node_modules rule, so it
      // has to carry it: without it React itself was wrapped in refresh
      // signatures and pulled the refresh runtime into every bundle.
      refreshExclude: (resourcePath: string) =>
        /[\\/]node_modules[\\/]/.test(resourcePath) ||
        isfeatureScriptsContentLike(resourcePath)
    })
    const maybeInstallPreact = await maybeUsePreact(projectPath, this.notices)
    const babelConfigPath = findProjectBabelConfig(projectPath)
    const maybeInstallVue = await maybeUseVue(
      projectPath,
      mode,
      this.define,
      this.notices
    )
    const maybeInstallSolid = await maybeUseSolid(
      projectPath,
      mode,
      transpilePackageDirs,
      !!babelConfigPath,
      this.notices
    )
    const maybeInstallSvelte = await maybeUseSvelte(projectPath, mode, {
      notices: this.notices,
      compiler
    })
    const tsConfigPath = getUserTypeScriptConfigFile(projectPath)
    const tsRoot = tsConfigPath ? path.dirname(tsConfigPath) : manifestDir
    // isUsingTypeScript is gated on the config existing, so a second operand
    // reading it here could never add anything: the config IS the signal
    // (ensureTypeScriptConfig above scaffolds it for TS projects).
    const preferTypeScript = !!tsConfigPath
    const resolveConfigPath = tsConfigPath ?? getUserJsConfigFile(projectPath)
    // The same config chooses decorator semantics, the way tsc reads them,
    // and the other transform flags SWC follows.
    const decorators = swcDecoratorTransform(resolveConfigPath)
    const transformFlags = resolveConfigPath
      ? readTransformFlags(resolveConfigPath)
      : {}
    const useDefineForClassFields =
      typeof transformFlags.useDefineForClassFields === 'boolean'
        ? {useDefineForClassFields: transformFlags.useDefineForClassFields}
        : {}

    const targets = resolveEngineTargets(manifest as Manifest, this.browser)

    compiler.options.resolve.alias = {
      ...(maybeInstallReact?.alias || {}),
      ...(maybeInstallPreact?.alias || {}),
      ...(maybeInstallVue?.alias || {}),
      ...(maybeInstallSolid?.alias || {}),
      ...(maybeInstallSvelte?.alias || {}),
      ...compiler.options.resolve.alias
    }

    // Preserve existing user rules (from extension.config.js) and avoid
    // duplicate Vue processing when the user already configured vue-loader.
    const existingRules = Array.isArray(compiler.options.module.rules)
      ? [...compiler.options.module.rules]
      : []

    let vueLoadersToAdd = maybeInstallVue?.loaders || []

    if (maybeInstallVue?.loaders?.length) {
      const vueRuleIndices = this.findVueLoaderRuleIndices(
        existingRules as LooseRuleSetRule[]
      )

      if (vueRuleIndices.length > 0) {
        const primary = vueRuleIndices[0]
        existingRules[primary] = this.mergeVueRule(
          existingRules[primary] as LooseRuleSetRule,
          maybeInstallVue.loaders[0] as LooseRuleSetRule
        ) as (typeof existingRules)[number]

        for (const idx of vueRuleIndices.slice(1).reverse()) {
          existingRules.splice(idx, 1)
        }

        // Do not add our own separate .vue rule; otherwise vue-loader runs twice.
        vueLoadersToAdd = []
      }
    }

    const swcRuleBase = {
      test: /\.(js|cjs|mjs|jsx|mjsx|ts|mts|cts|tsx|mtsx)$/,
      // Explicit javascript/auto so rspack detects script-vs-module from the file
      // itself; Chrome never reads package.json "type", unlike rspack's default inference.
      type: 'javascript/auto',
      // No include: a source outside the project root, such as a workspace
      // sibling imported by path, compiles like any project file.
      exclude: [excludeScriptsInNodeModules],
      resourceQuery: NOT_RAW_RESOURCE_QUERY
    }

    const jsxInPlainJs = isUsingJsxFramework(projectPath)
    const jsxImportSource =
      typeof transformFlags.jsxImportSource === 'string' &&
      transformFlags.jsxImportSource
        ? transformFlags.jsxImportSource
        : getJsxImportSource(projectPath)
    const isPlatformModule = (resourcePath: string) =>
      platformModulePaths.has(toResourceKey(resourcePath))

    // One loader entry per file kind: the extension picks the parser, the
    // rule picks module-ness, the installed framework picks the JSX runtime.
    const swcLoaderFor = (
      resourcePath: string,
      options: {refresh: boolean; module: boolean}
    ): {loader: string; options: SwcLoaderOptions} => ({
      loader: 'builtin:swc-loader',
      options: {
        module: {
          type: 'es6'
        },
        // Content scripts and background.scripts load as classic sloppy scripts
        // where octal escapes are legal, so they keep per-file detection. Files
        // the browser loads as modules compile as modules: in script form the
        // automatic JSX runtime becomes a require() no page can run.
        isModule: options.module ? true : 'unknown',
        sourceMaps: wantsSourceMaps,
        env: {targets},
        jsc: {
          parser: {
            ...swcParserForFile(resourcePath, jsxInPlainJs),
            decorators: true
          },
          transform: {
            ...decorators,
            ...useDefineForClassFields,
            react: {
              runtime: 'automatic',
              importSource: jsxImportSource,
              refresh: options.refresh
            }
          }
        }
      }
    })

    // Static variants (not a use() function): vue-loader's plugin recompiles
    // every rule and keeps only static loader entries.
    const parserVariants = (options: {refresh: boolean; module: boolean}) => [
      {test: /\.(tsx|mtsx)$/, use: swcLoaderFor('file.tsx', options)},
      {test: /\.(ts|mts|cts)$/, use: swcLoaderFor('file.ts', options)},
      {test: /\.(jsx|mjsx)$/, use: swcLoaderFor('file.jsx', options)},
      {use: swcLoaderFor('file.js', options)}
    ]

    // Refresh is React's, in development. Only then does the background
    // compile in its own layer, through the same rules with refresh left out.
    const refresh = usesReactRefresh(projectPath, mode)
    const surfaces: Array<{issuerLayer: unknown; refresh: boolean}> = refresh
      ? [
          {
            issuerLayer: {
              not: [
                EXTENSIONJS_CONTENT_SCRIPT_LAYER,
                EXTENSIONJS_BACKGROUND_LAYER
              ]
            },
            refresh: true
          },
          {issuerLayer: EXTENSIONJS_BACKGROUND_LAYER, refresh: false}
        ]
      : [
          {
            issuerLayer: {not: EXTENSIONJS_CONTENT_SCRIPT_LAYER},
            refresh: false
          }
        ]

    const swcRules: LooseRuleSetRule[] = [
      {
        ...swcRuleBase,
        layer: EXTENSIONJS_CONTENT_SCRIPT_LAYER,
        include: (resourcePath: string) =>
          isfeatureScriptsContentLike(resourcePath),
        oneOf: parserVariants({refresh: false, module: false})
      },
      {
        ...swcRuleBase,
        issuerLayer: EXTENSIONJS_CONTENT_SCRIPT_LAYER,
        layer: EXTENSIONJS_CONTENT_SCRIPT_LAYER,
        // The rule above already compiles these: matching both ran the
        // transpiler a second time on its own output.
        exclude: [
          ...swcRuleBase.exclude,
          (resourcePath: string) => isfeatureScriptsContentLike(resourcePath)
        ],
        oneOf: parserVariants({refresh: false, module: false})
      },
      ...surfaces.map((surface) => ({
        ...swcRuleBase,
        issuerLayer: surface.issuerLayer,
        // Classic concat entries (content_scripts AND MV2 background.scripts) share one
        // scope and are never ESM; excluded here or Rspack emits hash-named assets.
        resourceQuery: {
          not: [/__extensionjs_classic_concat__/, RAW_RESOURCE_QUERY]
        },
        // Page/background scripts stay javascript/auto so script-vs-module is detected
        // per file, matching browser loading; platform-declared modules get ESM below.
        exclude: [
          ...swcRuleBase.exclude,
          (resourcePath: string) => isfeatureScriptsContentLike(resourcePath),
          (resourcePath: string) => isPlatformModule(resourcePath)
        ],
        oneOf: parserVariants({refresh: surface.refresh, module: false})
      })),
      // Platform-declared ES modules only, compiled as modules; the
      // content-script exclusion keeps a doubly-declared file's cs instance classic.
      ...(platformModulePaths.size > 0
        ? surfaces.map((surface) => ({
            test: swcRuleBase.test,
            issuerLayer: surface.issuerLayer,
            include: (resourcePath: string) => isPlatformModule(resourcePath),
            exclude: [
              (resourcePath: string) =>
                isfeatureScriptsContentLike(resourcePath)
            ],
            resourceQuery: {
              not: [/__extensionjs_classic_concat__/, RAW_RESOURCE_QUERY]
            },
            type: 'javascript/esm',
            oneOf: parserVariants({refresh: surface.refresh, module: true})
          }))
        : [])
    ]

    // The project's Babel config runs first on the source and SWC compiles
    // what it returns, so TypeScript, JSX, targets and refresh stay SWC's.
    const babelRules: LooseRuleSetRule[] = []

    if (babelConfigPath) {
      const babelLoader = await ensureOptionalPackageResolved({
        integration: 'Babel',
        projectPath,
        dependencyId: 'babel-loader',
        installDependencies: ['babel-loader', '@babel/core']
      })
      const babelFor = (kind: BabelFileKind) => ({
        loader: babelLoader,
        options: projectBabelOptions({
          projectPath,
          kind,
          jsxInPlainJs,
          legacyDecorators: 'legacyDecorator' in decorators
        })
      })

      babelRules.push({
        // Solid's own Babel pass already loads the project config for the
        // files it compiles, so only .ts files are left to this one.
        test: maybeInstallSolid ? /\.(ts|mts|cts)$/ : swcRuleBase.test,
        exclude: [excludeNodeModules],
        resourceQuery: NOT_RAW_RESOURCE_QUERY,
        oneOf: [
          {test: /\.(tsx|mtsx)$/, use: babelFor('tsx')},
          {test: /\.(ts|mts|cts)$/, use: babelFor('ts')},
          {test: /\.(jsx|mjsx)$/, use: babelFor('jsx')},
          {use: babelFor('js')}
        ]
      })
    }

    // The swc and Babel rules are built loose, so they are read as rules here.
    compiler.options.module.rules = [
      ...(swcRules as RuleSetRule[]),
      ...(maybeInstallReact?.loaders || []),
      ...(maybeInstallPreact?.loaders || []),
      ...vueLoadersToAdd,
      // After the swc rules on purpose: loaders run last rule first, so
      // Solid's compiler sees the JSX before swc gets the plain output.
      ...(maybeInstallSolid?.loaders || []),
      ...(maybeInstallSvelte?.loaders || []),
      ...(babelRules as RuleSetRule[]),
      ...existingRules
    ].filter(Boolean)

    this.applyReactPlugins(compiler, maybeInstallReact?.plugins || [])

    maybeInstallPreact?.plugins?.forEach((plugin) => {
      plugin.apply(compiler)
    })

    maybeInstallVue?.plugins?.forEach((plugin) => {
      plugin.apply(compiler)
    })

    maybeInstallSvelte?.plugins?.forEach((plugin) => {
      plugin.apply(compiler)
    })

    if (resolveConfigPath) {
      compiler.options.resolve.tsConfig = {
        configFile: resolveConfigPath
      }
    }

    if (isDebug()) {
      const integrations: string[] = []

      if (maybeInstallReact) integrations.push('React')
      if (maybeInstallPreact) integrations.push('Preact')
      if (maybeInstallVue) integrations.push('Vue')
      if (maybeInstallSolid) integrations.push('Solid')
      if (maybeInstallSvelte) integrations.push('Svelte')
      if (preferTypeScript) integrations.push('TypeScript')

      debugLine(messages.jsFrameworksIntegrationsEnabled(integrations))

      debugLine(
        messages.jsFrameworksConfigsDetected(tsConfigPath, tsRoot, targets)
      )

      if (babelConfigPath) {
        debugLine(messages.jsFrameworksBabelConfig(babelConfigPath))
      }

      // Preact is deliberately absent: its fast-refresh is disabled (broken
      // upstream plugin) so it runs on live reload, like Vue's remount.
      const hmrFrameworks: string[] = []
      if (maybeInstallReact) hmrFrameworks.push('React')
      if (maybeInstallSvelte) hmrFrameworks.push('Svelte')

      debugLine(
        messages.jsFrameworksHmrSummary(mode === 'development', hmrFrameworks)
      )
    }
  }

  // The refresh runtime goes in front of page entries only. The bundler
  // reads the entry map once, through entryOption, after every plugin has
  // added its entries and before anything else runs; a later hook is too late.
  private placeRefreshEntries(compiler: Compiler) {
    const projectPath = compiler.options.context as string
    const mode = compiler.options.mode || 'development'

    if (!usesReactRefresh(projectPath, mode)) return

    const refreshEntries = [resolveReactRefreshEntry(projectPath)].filter(
      (file): file is string => typeof file === 'string'
    )

    compiler.hooks.entryOption.tap(
      JsFrameworksPlugin.name,
      (_context, entry) => {
        const target = entry as EntryMap
        const next = withBackgroundLayer(
          withRefreshEntries(target, refreshEntries)
        )

        for (const [name, description] of Object.entries(next)) {
          target[name] = description
        }

        return undefined
      }
    )
  }

  public async apply(compiler: Compiler) {
    const mode = compiler.options.mode || 'development'

    if (mode === 'production') {
      // build runs via compiler.run(), which awaits beforeRun before reading rules.
      compiler.hooks.beforeRun.tapPromise(JsFrameworksPlugin.name, () =>
        this.configureOptions(compiler)
      )

      return
    }

    this.placeRefreshEntries(compiler)

    // dev/watch: configure eagerly and gate the first compilation on the one
    // promise from both hooks. watchRun covers the dev server; beforeRun covers
    // a one-shot development build (compiler.run), which otherwise read the
    // rules while the async contract resolution was still racing.
    const configuring = setupInOrder(compiler, () =>
      this.configureOptions(compiler)
    )
    compiler.hooks.beforeRun.tapPromise(
      JsFrameworksPlugin.name,
      () => configuring
    )

    compiler.hooks.watchRun.tapPromise(
      JsFrameworksPlugin.name,
      () => configuring
    )

    await configuring
  }
}

type EntryDescription = {import?: string | string[]; layer?: string}
export type EntryMap = Record<string, EntryDescription | string | string[]>

function usesReactRefresh(projectPath: string, mode: string): boolean {
  return mode === 'development' && isUsingReact(projectPath)
}

// The service worker, the scripts list and the background page: a document
// nobody sees runs the same sources and has nothing to refresh either.
function isBackgroundEntry(name: string): boolean {
  return name.startsWith('background')
}

// Put every background entry in its own layer, so the rules can tell what
// it imports from what a page imports.
export function withBackgroundLayer(entry: EntryMap | undefined): EntryMap {
  const next: EntryMap = {}

  for (const [name, description] of Object.entries(entry || {})) {
    if (
      !isBackgroundEntry(name) ||
      !description ||
      (typeof description === 'object' &&
        !Array.isArray(description) &&
        description.layer)
    ) {
      next[name] = description
      continue
    }

    next[name] =
      typeof description === 'string' || Array.isArray(description)
        ? {import: [description].flat(), layer: EXTENSIONJS_BACKGROUND_LAYER}
        : {...description, layer: EXTENSIONJS_BACKGROUND_LAYER}
  }

  return next
}

// Prepend the framework refresh runtimes to every page entry: not the
// content-script layer, whose bundles run inside someone else's page (a MAIN
// world one shares the page's globals), and not the background, which has no
// window to refresh.
export function withRefreshEntries(
  entry: EntryMap | undefined,
  refreshEntries: string[]
): EntryMap {
  if (!entry || typeof entry !== 'object' || refreshEntries.length === 0) {
    return entry || {}
  }

  const next: EntryMap = {}

  for (const [name, description] of Object.entries(entry)) {
    if (
      !description ||
      typeof description !== 'object' ||
      Array.isArray(description) ||
      description.layer === EXTENSIONJS_CONTENT_SCRIPT_LAYER ||
      isBackgroundEntry(name)
    ) {
      next[name] = description
      continue
    }

    const imports = Array.isArray(description.import)
      ? description.import
      : description.import
        ? [description.import]
        : []
    const missing = refreshEntries.filter((file) => !imports.includes(file))

    next[name] =
      missing.length === 0
        ? description
        : {...description, import: [...missing, ...imports]}
  }

  return next
}
