//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {
  filterKeysForThisBrowser,
  getManifestFieldsData
} from 'browser-extension-manifest-fields'
import {type ParsedJson, parseJsonSafe} from '../lib/parse-json-safe'
import {toResourceKey} from '../lib/resource-path'
import {isSubPath, resolveTranspilePackageDirs} from '../lib/transpile-packages'
import {getSpecialFoldersDataForCompiler} from '../plugin-special-folders/get-data'
import {getAssetsFromHtml} from '../plugin-web-extension/feature-html/html-lib/utils'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../plugin-web-extension/feature-scripts/contracts'
import type {DevOptions, PluginInterface} from '../types'
import * as messages from './js-frameworks-lib/messages'
import {isUsingPreact, maybeUsePreact} from './js-tools/preact'
import {isUsingReact, maybeUseReact} from './js-tools/react'
import {maybeUseSvelte} from './js-tools/svelte'
import {
  ensureTypeScriptConfig,
  getUserTypeScriptConfigFile,
  isUsingTypeScript
} from './js-tools/typescript'
import {maybeUseVue} from './js-tools/vue'

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

  private patchReactRefreshRules(rules: LooseRuleSetRule[]) {
    for (const rule of rules) {
      if (!rule || typeof rule !== 'object') continue

      const uses = Array.isArray(rule.use)
        ? rule.use
        : rule.use
          ? [rule.use]
          : rule.loader
            ? [{loader: rule.loader}]
            : []
      const hasReactRefreshLoader = uses.some((useEntry) =>
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
    // Every entry AND probe of these path sets goes through toResourceKey: mixing
    // path.resolve and path.normalize never matches on Windows (drive letter).
    const contentScriptLikePaths = new Set<string>()
    const scriptsDir = toResourceKey(path.resolve(projectPath, 'scripts'))
    const isfeatureScriptsContentLike = (resourcePath: string) => {
      const normalized = toResourceKey(resourcePath)

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

    // Enable SWC sourcemaps whenever the build emits sourcemaps: dev defaults on
    // unless devtool is disabled; production only on devtool opt-in.
    const devtool = (compiler.options as {devtool?: unknown}).devtool
    const wantsSourceMaps =
      devtool !== false && (mode === 'development' || devtool != null)

    let manifest: ParsedJson = {}
    try {
      manifest = parseJsonSafe(fs.readFileSync(this.manifestPath, 'utf-8'))
    } catch {}

    const contentScripts = Array.isArray(manifest?.content_scripts)
      ? manifest.content_scripts
      : []

    for (const contentScript of contentScripts) {
      const jsList = Array.isArray(contentScript?.js) ? contentScript.js : []

      for (const jsFile of jsList) {
        contentScriptLikePaths.add(
          toResourceKey(path.resolve(manifestDir, jsFile))
        )
      }
    }

    // Browsers parse a script as an ES module only where the platform declares it;
    // everything else loads classic, so only declared modules are force-marked ESM below.
    const platformModulePaths = new Set<string>()
    try {
      const browserManifest = filterKeysForThisBrowser(manifest, this.browser)
      const background = browserManifest?.background
      if (
        background?.type === 'module' &&
        typeof background?.service_worker === 'string'
      ) {
        platformModulePaths.add(
          toResourceKey(path.resolve(manifestDir, background.service_worker))
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
          platformModulePaths.add(toResourceKey(moduleScript))
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
      test: /\.(js|cjs|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
      // Explicit javascript/auto so rspack detects script-vs-module from the file
      // itself; Chrome never reads package.json "type", unlike rspack's default inference.
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
        // Keep SWC transform-only: Rspack owns production minification, and disabling
        // SWC minify preserves magic comments like /* webpackIgnore: true */.
        minify: false,
        // Auto-detect script vs module per file: content scripts and background.scripts
        // load as classic sloppy scripts where octal escapes are legal; forced ESM rejects them.
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

    const swcRules: LooseRuleSetRule[] = [
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
        // Classic concat entries (content_scripts AND MV2 background.scripts) share one
        // scope and are never ESM; excluded here or Rspack emits hash-named assets.
        resourceQuery: {not: /__extensionjs_classic_concat__/},
        // Page/background scripts stay javascript/auto so script-vs-module is detected
        // per file, matching browser loading; platform-declared modules get ESM below.
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
      // Platform-declared ES modules only; rspack merges matching rules, and the
      // content-script exclusion keeps a doubly-declared file's cs instance classic.
      ...(platformModulePaths.size > 0
        ? [
            {
              test: swcRuleBase.test,
              include: (resourcePath: string) =>
                platformModulePaths.has(toResourceKey(resourcePath)),
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

    maybeInstallReact?.plugins?.forEach((plugin) => {
      plugin.apply(compiler)
    })
    maybeInstallPreact?.plugins?.forEach((plugin) => {
      plugin.apply(compiler)
    })
    maybeInstallVue?.plugins?.forEach((plugin) => {
      plugin.apply(compiler)
    })
    maybeInstallSvelte?.plugins?.forEach((plugin) => {
      plugin.apply(compiler)
    })

    this.patchReactRefreshRules(
      compiler.options.module.rules as LooseRuleSetRule[]
    )

    if (isUsingTypeScript(projectPath) || !!tsConfigPath) {
      compiler.options.resolve.tsConfig = {
        configFile: tsConfigPath as string
      }
    }

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

      // Preact is deliberately absent: its fast-refresh is disabled (broken
      // upstream plugin) so it runs on live reload, like Vue's remount.
      const hmrFrameworks: string[] = []
      if (maybeInstallReact) hmrFrameworks.push('React')
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
    // dev/watch: beforeRun never fires, so configure eagerly and gate the first
    // compilation via watchRun, closing the race with async contract resolution.
    const configuring = this.configureOptions(compiler)
    compiler.hooks.watchRun.tapPromise(
      JsFrameworksPlugin.name,
      () => configuring
    )

    await configuring
  }
}
