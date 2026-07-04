//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {type Compiler} from '@rspack/core'
import {
  getManifestFieldsData,
  filterKeysForThisBrowser
} from 'browser-extension-manifest-fields'
import type {PluginInterface, DevOptions} from '../types'
import {isUsingPreact, maybeUsePreact} from './js-tools/preact'
import {isUsingReact, maybeUseReact} from './js-tools/react'
import {maybeUseVue} from './js-tools/vue'
import {maybeUseSvelte} from './js-tools/svelte'
// import {maybeUseAngular} from './js-tools/angular'
// import {maybeUseSolid} from './js-tools/solid'
import * as messages from './js-frameworks-lib/messages'
import {parseJsonSafe} from '../lib/parse-json-safe'
import {
  isUsingTypeScript,
  ensureTypeScriptConfig,
  getUserTypeScriptConfigFile
} from './js-tools/typescript'
import {isSubPath, resolveTranspilePackageDirs} from '../lib/transpile-packages'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../plugin-web-extension/feature-scripts/contracts'
import {getAssetsFromHtml} from '../plugin-web-extension/feature-html/html-lib/utils'
import {getSpecialFoldersDataForCompiler} from '../plugin-special-folders/get-data'

export class JsFrameworksPlugin {
  public static readonly name: string = 'plugin-js-frameworks'
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  public readonly mode: DevOptions['mode']
  public readonly transpilePackages: string[]

  constructor(
    options: PluginInterface & {
      mode: DevOptions['mode']
      transpilePackages?: string[]
    }
  ) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.mode = options.mode
    this.transpilePackages = options.transpilePackages || []
  }

  private findVueLoaderRuleIndices(rules: any[]): number[] {
    const indices: number[] = []
    for (let i = 0; i < rules.length; i++) {
      const rule: any = rules[i]
      const testStr = String(rule?.test?.toString?.() || rule?.test || '')
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

  private mergeVueRule(userRule: any, defaultRule: any): any {
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
      } else if (typeof merged.use === 'object') {
        merged.use = {
          ...merged.use,
          loader: merged.use?.loader || defaultRule?.loader,
          options: {
            ...(defaultRule?.options || {}),
            ...(merged.use?.options || {})
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

  private patchReactRefreshRules(rules: any[]) {
    for (const rule of rules) {
      if (!rule || typeof rule !== 'object') continue

      const uses = Array.isArray(rule.use)
        ? rule.use
        : rule.use
          ? [rule.use]
          : rule.loader
            ? [{loader: rule.loader}]
            : []
      const hasReactRefreshLoader = uses.some((useEntry: any) =>
        String(useEntry?.loader || '').includes('react-refresh-loader')
      )

      if (hasReactRefreshLoader) {
        rule.issuerLayer = {not: EXTENSIONJS_CONTENT_SCRIPT_LAYER}
      }

      if (Array.isArray(rule.oneOf)) {
        this.patchReactRefreshRules(rule.oneOf)
      }
      if (Array.isArray(rule.rules)) {
        this.patchReactRefreshRules(rule.rules)
      }
    }
  }

  private async configureOptions(compiler: Compiler) {
    const mode = compiler.options.mode || 'development'
    const projectPath = compiler.options.context as string
    const manifestDir = path.dirname(this.manifestPath)

    // Detection (isUsingTypeScript) is now pure, so the one-time tsconfig
    // setup/throw must be triggered explicitly at this build chokepoint
    ensureTypeScriptConfig(projectPath)

    const swcIncludeDirs = Array.from(
      new Set([
        projectPath,
        manifestDir,
        ...resolveTranspilePackageDirs(projectPath, this.transpilePackages)
      ])
    )
    const contentScriptLikePaths = new Set<string>()
    const scriptsDir = path.resolve(projectPath, 'scripts')
    const isfeatureScriptsContentLike = (resourcePath: string) => {
      const normalized = path.normalize(resourcePath)

      if (contentScriptLikePaths.has(normalized)) {
        return true
      }

      const relToScripts = path.relative(scriptsDir, normalized)

      return (
        !!relToScripts &&
        !relToScripts.startsWith('..') &&
        !path.isAbsolute(relToScripts)
      )
    }

    // Enable SWC sourcemaps whenever the build is expected to emit sourcemaps.
    // - In development we default to on (better DX), unless the user explicitly disables `devtool`.
    // - In production we only enable when the user opts-in via `devtool` (e.g. "hidden-source-map").
    const devtool = (compiler.options as any).devtool
    const wantsSourceMaps =
      devtool !== false && (mode === 'development' || devtool != null)

    // Read the manifest once for both content-script detection and target derivation
    let manifest: any = {}
    try {
      manifest = parseJsonSafe(fs.readFileSync(this.manifestPath, 'utf-8'))
    } catch {
      // Fail silently
    }

    const contentScripts = Array.isArray(manifest?.content_scripts)
      ? manifest.content_scripts
      : []

    for (const contentScript of contentScripts) {
      const jsList = Array.isArray(contentScript?.js) ? contentScript.js : []

      for (const jsFile of jsList) {
        contentScriptLikePaths.add(path.resolve(manifestDir, jsFile))
      }
    }

    // Browsers parse a script as an ES module only where the platform declares
    // it: `<script type="module">` in an HTML page, or a `"type": "module"`
    // background service worker. Everything else — plain `<script src>` page
    // scripts, classic workers — loads as a classic script, so only declared
    // modules may be force-marked `javascript/esm` below.
    const platformModulePaths = new Set<string>()
    try {
      const browserManifest = filterKeysForThisBrowser(manifest, this.browser)
      const background = browserManifest?.background
      if (
        background?.type === 'module' &&
        typeof background?.service_worker === 'string'
      ) {
        platformModulePaths.add(
          path.normalize(path.resolve(manifestDir, background.service_worker))
        )
      }

      const htmlPages: Record<string, unknown> = {
        ...getManifestFieldsData({
          manifestPath: this.manifestPath,
          browser: this.browser
        }).html,
        ...getSpecialFoldersDataForCompiler(compiler).pages
      }
      for (const htmlPage of Object.values(htmlPages)) {
        if (typeof htmlPage !== 'string') continue
        for (const moduleScript of getAssetsFromHtml(htmlPage)?.moduleJs ||
          []) {
          platformModulePaths.add(path.normalize(moduleScript))
        }
      }
    } catch {
      // Fail open: with no declared modules everything parses as
      // `javascript/auto`, and import/export files are still detected as ESM
    }

    const maybeInstallReact = await maybeUseReact(projectPath, {
      disableRefresh: mode !== 'development',
      refreshExclude: (resourcePath: string) =>
        isfeatureScriptsContentLike(resourcePath)
    })
    const maybeInstallPreact = await maybeUsePreact(projectPath)
    const maybeInstallVue = await maybeUseVue(projectPath, mode)
    const maybeInstallSvelte = await maybeUseSvelte(projectPath, mode)
    const tsConfigPath = getUserTypeScriptConfigFile(projectPath)
    const tsRoot = tsConfigPath ? path.dirname(tsConfigPath) : manifestDir
    const transpilePackageDirs = swcIncludeDirs.filter(
      (dir) => dir !== projectPath && dir !== manifestDir
    )
    const preferTypeScript = !!tsConfigPath || isUsingTypeScript(projectPath)

    // Derive transpile targets from extension manifest for leaner output
    let targets: string[] = ['chrome >= 100']

    if (manifest?.minimum_chrome_version) {
      targets = [`chrome >= ${manifest.minimum_chrome_version}`]
    }

    const geckoMin =
      manifest?.browser_specific_settings?.gecko?.strict_min_version ||
      manifest?.applications?.gecko?.strict_min_version

    if (geckoMin) {
      const major = parseInt(String(geckoMin).split('.')[0], 10)

      if (!Number.isNaN(major)) {
        targets.push(`firefox >= ${major}`)
      }
    }

    compiler.options.resolve.alias = {
      ...(maybeInstallReact?.alias || {}),
      ...(maybeInstallPreact?.alias || {}),
      ...(maybeInstallVue?.alias || {}),
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
      const vueRuleIndices = this.findVueLoaderRuleIndices(existingRules)
      if (vueRuleIndices.length > 0) {
        // Merge our defaults (and any `vue.loader.*` customOptions) into the
        // user's first vue-loader rule, and remove other vue-loader rules.
        const primary = vueRuleIndices[0]
        existingRules[primary] = this.mergeVueRule(
          existingRules[primary],
          maybeInstallVue.loaders[0]
        )
        for (const idx of vueRuleIndices.slice(1).reverse()) {
          existingRules.splice(idx, 1)
        }
        // Do not add our own separate .vue rule; otherwise vue-loader runs twice.
        vueLoadersToAdd = []
      }
    }

    const swcRuleBase = {
      test: /\.(js|cjs|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
      // Explicit `javascript/auto` so rspack detects script-vs-module from the
      // file itself. Left implicit, rspack infers the type from the nearest
      // package.json `"type"` field — but Chrome never reads package.json:
      // a project with `"type": "commonjs"` (Node tooling) still loads its
      // `"type": "module"` service worker graph as ESM, and one with
      // `"type": "module"` still loads classic sloppy content scripts. The
      // platform-declared-ESM marker rule below still wins where it matches.
      type: 'javascript/auto',
      include: Array.from(new Set([tsRoot, ...swcIncludeDirs])),
      exclude: [
        (resourcePath: string) => {
          const isInNodeModules = /[\\/]node_modules[\\/]/.test(resourcePath)
          if (!isInNodeModules) {
            return false
          }

          return !transpilePackageDirs.some((dir) =>
            isSubPath(resourcePath, dir)
          )
        }
      ]
    }

    const swcLoaderBase = {
      loader: 'builtin:swc-loader',
      options: {
        sync: true,
        module: {
          type: 'es6'
        },
        // Keep SWC in transform-only mode. Production minification is handled
        // by Rspack optimization, and disabling SWC minify preserves magic
        // comments like /* webpackIgnore: true */ for native dynamic imports
        minify: false,
        // Auto-detect script vs module per file. Browsers load content scripts
        // and background.scripts as classic sloppy-mode scripts, where legacy
        // octal escapes and loose semantics are legal — forcing every file
        // through strict-mode ESM parsing rejects Chrome-valid extensions (and
        // multi-MB data scripts full of octal escapes melt the SWC diagnostic
        // renderer). Files with import/export still parse as strict modules.
        isModule: 'unknown',
        sourceMap: wantsSourceMaps,
        env: {targets},
        jsc: {
          parser: {
            syntax: preferTypeScript ? 'typescript' : 'ecmascript',
            tsx: preferTypeScript
              ? true
              : isUsingTypeScript(projectPath) &&
                (isUsingReact(projectPath) || isUsingPreact(projectPath)),
            jsx:
              !preferTypeScript &&
              (isUsingReact(projectPath) || isUsingPreact(projectPath)),
            dynamicImport: true
          },
          transform: {
            react: {
              development: mode === 'development',
              runtime: 'automatic',
              importSource: 'react',
              ...(isUsingPreact(projectPath)
                ? {
                    pragma: 'h',
                    pragmaFrag: 'Fragment',
                    throwIfNamespace: true,
                    useBuiltins: false
                  }
                : {})
            }
          }
        }
      }
    }

    const swcRules: any[] = [
      {
        ...swcRuleBase,
        layer: EXTENSIONJS_CONTENT_SCRIPT_LAYER,
        include: (resourcePath: string) =>
          Array.from(new Set([tsRoot, ...swcIncludeDirs])).some((dir) =>
            isSubPath(resourcePath, dir)
          ) && isfeatureScriptsContentLike(resourcePath),
        use: {
          ...swcLoaderBase,
          options: {
            ...swcLoaderBase.options,
            jsc: {
              ...swcLoaderBase.options.jsc,
              transform: {
                ...swcLoaderBase.options.jsc.transform,
                react: {
                  ...swcLoaderBase.options.jsc.transform.react,
                  refresh: false
                }
              }
            }
          }
        }
      },
      {
        ...swcRuleBase,
        issuerLayer: EXTENSIONJS_CONTENT_SCRIPT_LAYER,
        layer: EXTENSIONJS_CONTENT_SCRIPT_LAYER,
        use: {
          ...swcLoaderBase,
          options: {
            ...swcLoaderBase.options,
            jsc: {
              ...swcLoaderBase.options.jsc,
              transform: {
                ...swcLoaderBase.options.jsc.transform,
                react: {
                  ...swcLoaderBase.options.jsc.transform.react,
                  refresh: false
                }
              }
            }
          }
        }
      },
      {
        ...swcRuleBase,
        issuerLayer: {not: EXTENSIONJS_CONTENT_SCRIPT_LAYER},
        // Classic multi-file concat entries (content_scripts AND MV2
        // background.scripts) carry the __extensionjs_classic_concat__ query and
        // are always plain concatenated classic scripts sharing one scope — never
        // ES modules. They must be excluded here or Rspack marks the synthetic
        // entry `javascript/esm` and emits it as a hash-named asset instead of the
        // canonical `background/scripts.js` chunk (a content_scripts concat only
        // dodges this by matching `isfeatureScriptsContentLike` below).
        resourceQuery: {not: /__extensionjs_classic_concat__/},
        // Page/background scripts stay `javascript/auto` (explicit, via the
        // base rule) so Rspack detects script-vs-module per file (import/export → ESM),
        // matching how browsers load a plain `<script src>` page script as a
        // classic sloppy-mode script. Force-parsing these as strict ESM
        // rejected Chrome-valid classic scripts and melted the diagnostic
        // renderer on multi-MB legacy-octal data scripts. Platform-declared
        // modules (`<script type="module">`, `"type": "module"` service
        // workers) are marked `javascript/esm` by the dedicated rule below so
        // their legal top-level await parses even without import/export.
        exclude: [
          ...swcRuleBase.exclude,
          (resourcePath: string) => isfeatureScriptsContentLike(resourcePath)
        ],
        use: {
          ...swcLoaderBase,
          options: {
            ...swcLoaderBase.options,
            jsc: {
              ...swcLoaderBase.options.jsc,
              transform: {
                ...swcLoaderBase.options.jsc.transform,
                react: {
                  ...swcLoaderBase.options.jsc.transform.react,
                  refresh: mode === 'development'
                }
              }
            }
          }
        }
      },
      // Platform-declared ES modules only. Rspack merges every matching
      // rule, so this adds `type: 'javascript/esm'` on top of the loader
      // rule above without duplicating it. The content-script exclusion
      // covers a file declared both as a content script and a module page
      // script — the content-script instance must stay classic.
      ...(platformModulePaths.size > 0
        ? [
            {
              test: swcRuleBase.test,
              include: (resourcePath: string) =>
                platformModulePaths.has(path.normalize(resourcePath)),
              exclude: [
                (resourcePath: string) =>
                  isfeatureScriptsContentLike(resourcePath)
              ],
              resourceQuery: {not: /__extensionjs_classic_concat__/},
              type: 'javascript/esm'
            }
          ]
        : [])
    ]

    compiler.options.module.rules = [
      ...swcRules,
      ...(maybeInstallReact?.loaders || []),
      ...(maybeInstallPreact?.loaders || []),
      ...vueLoadersToAdd,
      ...(maybeInstallSvelte?.loaders || []),
      ...existingRules
    ].filter(Boolean)

    maybeInstallReact?.plugins?.forEach((plugin) => plugin.apply(compiler))
    maybeInstallPreact?.plugins?.forEach((plugin) => plugin.apply(compiler))
    maybeInstallVue?.plugins?.forEach((plugin) => plugin.apply(compiler))
    maybeInstallSvelte?.plugins?.forEach((plugin) => plugin.apply(compiler))

    this.patchReactRefreshRules(compiler.options.module.rules as any[])

    if (isUsingTypeScript(projectPath) || !!tsConfigPath) {
      compiler.options.resolve.tsConfig = {
        configFile: tsConfigPath as string
      }
    }

    // Author mode: summarize JS frameworks and configs
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      const integrations: string[] = []

      if (maybeInstallReact) integrations.push('React')
      if (maybeInstallPreact) integrations.push('Preact')
      if (maybeInstallVue) integrations.push('Vue')
      if (maybeInstallSvelte) integrations.push('Svelte')
      if (preferTypeScript) integrations.push('TypeScript')

      console.log(messages.jsFrameworksIntegrationsEnabled(integrations))

      console.log(
        messages.jsFrameworksConfigsDetected(tsConfigPath, tsRoot, targets)
      )

      const hmrFrameworks: string[] = []
      if (maybeInstallReact) hmrFrameworks.push('React')
      if (maybeInstallPreact) hmrFrameworks.push('Preact')
      if (maybeInstallSvelte) hmrFrameworks.push('Svelte')

      console.log(
        messages.jsFrameworksHmrSummary(mode === 'development', hmrFrameworks)
      )
    }
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
    // dev/watch: beforeRun never fires, so begin configuring eagerly and also
    // gate the first compilation on the same promise via watchRun. This closes
    // the race where the compiler could read module.rules / resolve.alias before
    // the (async) framework-contract resolution finished mutating them
    const configuring = this.configureOptions(compiler)
    compiler.hooks.watchRun.tapPromise(
      JsFrameworksPlugin.name,
      () => configuring
    )

    await configuring
  }
}
