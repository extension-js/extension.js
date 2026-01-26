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
import type {PluginInterface, DevOptions} from '../webpack-types'
import {isUsingPreact, maybeUsePreact} from './js-tools/preact'
import {isUsingReact, maybeUseReact} from './js-tools/react'
import {maybeUseVue} from './js-tools/vue'
import {
  isUsingTypeScript,
  getUserTypeScriptConfigFile
} from './js-tools/typescript'
import {maybeUseSvelte} from './js-tools/svelte'
// import {maybeUseAngular} from './js-tools/angular'
// import {maybeUseSolid} from './js-tools/solid'
import * as messages from './js-frameworks-lib/messages'

export class JsFrameworksPlugin {
  public static readonly name: string = 'plugin-js-frameworks'
  public readonly manifestPath: string
  public readonly mode: DevOptions['mode']

  constructor(options: PluginInterface & {mode: DevOptions['mode']}) {
    this.manifestPath = options.manifestPath
    this.mode = options.mode
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

  private async configureOptions(compiler: Compiler) {
    const mode = compiler.options.mode || 'development'
    const projectPath = compiler.options.context as string

    // Enable SWC sourcemaps whenever the build is expected to emit sourcemaps.
    // - In development we default to on (better DX), unless the user explicitly disables `devtool`.
    // - In production we only enable when the user opts-in via `devtool` (e.g. "hidden-source-map").
    const devtool = (compiler.options as any).devtool
    const wantsSourceMaps =
      devtool !== false && (mode === 'development' || devtool != null)

    const maybeInstallReact = await maybeUseReact(projectPath)
    const maybeInstallPreact = await maybeUsePreact(projectPath)
    const maybeInstallVue = await maybeUseVue(projectPath, mode)
    const maybeInstallSvelte = await maybeUseSvelte(projectPath, mode)
    const tsConfigPath = getUserTypeScriptConfigFile(projectPath)
    const manifestDir = path.dirname(this.manifestPath)
    const tsRoot = tsConfigPath ? path.dirname(tsConfigPath) : manifestDir
    const preferTypeScript = !!tsConfigPath || isUsingTypeScript(projectPath)

    // Derive transpile targets from extension manifest for leaner output
    let targets: string[] = ['chrome >= 100']

    const parseJsonSafe = (text: string) => {
      const s = text && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
      return JSON.parse(s || '{}')
    }

    try {
      const manifest = parseJsonSafe(
        fs.readFileSync(this.manifestPath, 'utf-8')
      )

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
    } catch {
      // Fail silently
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

    compiler.options.module.rules = [
      {
        test: /\.(js|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
        include: Array.from(new Set([tsRoot, manifestDir])),
        exclude: [/[\\/]node_modules[\\/]/],
        use: {
          loader: 'builtin:swc-loader',
          options: {
            sync: true,
            module: {
              type: 'es6'
            },
            minify: mode === 'production',
            isModule: true,
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
                  refresh: mode === 'development',
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
      },
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
      compiler.hooks.beforeRun.tapPromise(
        JsFrameworksPlugin.name,
        async () => await this.configureOptions(compiler)
      )
      return
    }
    await this.configureOptions(compiler)
  }
}
