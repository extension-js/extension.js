//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {type Compiler, type RuleSetRule} from '@rspack/core'
import * as messages from './css-lib/messages'
import {hasDependency} from '../lib/has-dependency'
import {maybeUseSass} from './css-tools/sass'
import {maybeUseLess} from './css-tools/less'
import {cssInContentScriptLoader} from './css-in-content-script-loader'
import {cssInHtmlLoader} from './css-in-html-loader'
import type {DevOptions, PluginInterface} from '../types'
import {getTailwindConfigFile} from './css-tools/tailwind'
import {findPostCssConfig} from './css-tools/postcss'

// Re-export CSS utilities so other plugins can import from @plugin-css
export {resolveCssAsset} from './css-lib/resolve-css-asset'
export type {CssAssetResult} from './css-lib/resolve-css-asset'
export {injectCssLink} from './css-lib/inject-css-link'

export class CssPlugin {
  public static readonly name: string = 'plugin-css'

  public readonly manifestPath: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
  }

  private async configureOptions(compiler: Compiler) {
    const mode: DevOptions['mode'] =
      (compiler.options.mode as DevOptions['mode']) || 'development'
    const projectPath = (compiler.options.context as string) || process.cwd()

    const manifestPath = this.manifestPath
    const usingSass = hasDependency(projectPath, 'sass')
    const usingLess = hasDependency(projectPath, 'less')

    // We have two main loaders:
    // 1. cssInContentScriptLoader - for CSS in content scripts
    // 2. cssInHtmlLoader - for CSS in HTML
    // The reason is that for content scripts we need to use the asset loader
    // because it's a content script and we need to load it as an asset.
    // For HTML we need to use the css loader because it's a HTML file
    // and we need to load it as a CSS file.
    // Trigger the optional-package contract so sass-loader / less-loader get
    // resolved (and installed if missing) before the CSS loader chain runs.
    await maybeUseSass(projectPath)
    await maybeUseLess(projectPath)

    const loaders: RuleSetRule[] = [
      ...(await cssInContentScriptLoader(projectPath, manifestPath, mode, {
        useSass: usingSass,
        useLess: usingLess
      })),
      ...(await cssInHtmlLoader(projectPath, mode, manifestPath, {
        useSass: usingSass,
        useLess: usingLess
      }))
    ]

    // CSS output naming.  Rspack's native CSS (`experiments.css`) already
    // bakes a content-hash into [name] for CSS chunks split from content-
    // script imports (e.g. "content_scripts/styles.fe21de80.css"), so a
    // plain [name].css is sufficient for both dev and production — no
    // extra [fullhash] template is needed.
    compiler.options.output.cssFilename = '[name].css'
    compiler.options.output.cssChunkFilename = '[name].css'

    // Update compiler configuration
    compiler.options.module.rules = [
      ...compiler.options.module.rules,
      ...loaders
    ].filter(Boolean)

    // Author mode: summarize CSS integrations and configs
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      const integrations: string[] = []
      const usingTailwind = hasDependency(projectPath, 'tailwindcss')
      const usingPostcss =
        hasDependency(projectPath, 'postcss') ||
        findPostCssConfig(projectPath) !== undefined ||
        usingSass ||
        usingLess ||
        usingTailwind

      if (usingPostcss) integrations.push('PostCSS')
      if (usingSass) integrations.push('Sass')
      if (usingLess) integrations.push('Less')
      if (usingTailwind) integrations.push('Tailwind')

      console.log(messages.cssIntegrationsEnabled(integrations))

      const postcssConfig = findPostCssConfig(projectPath)
      const tailwindConfig = getTailwindConfigFile(projectPath)
      const browserslistSource = findBrowserslistSource(projectPath)

      console.log(
        messages.cssConfigsDetected(
          postcssConfig,
          tailwindConfig,
          browserslistSource
        )
      )
    }
  }

  public async apply(compiler: Compiler) {
    const mode = compiler.options.mode || 'development'
    if (mode === 'production') {
      // build runs via compiler.run(), which awaits beforeRun before reading rules.
      compiler.hooks.beforeRun.tapPromise(CssPlugin.name, () =>
        this.configureOptions(compiler)
      )
      return
    }
    // dev/watch: beforeRun never fires, so begin configuring eagerly and also
    // gate the first compilation on the same promise via watchRun. This closes
    // the race where the compiler could read module.rules before the (async)
    // loader-contract resolution finished mutating them.
    const configuring = this.configureOptions(compiler)
    compiler.hooks.watchRun.tapPromise(CssPlugin.name, () => configuring)
    await configuring
  }
}

function findBrowserslistSource(projectPath: string): string | undefined {
  // package.json browserslist
  const packageJsonPath = path.join(projectPath, 'package.json')
  try {
    if (fs.existsSync(packageJsonPath)) {
      const raw = fs.readFileSync(packageJsonPath, 'utf8')
      const pkg = JSON.parse(raw || '{}')
      if (pkg && pkg.browserslist) return `${packageJsonPath}#browserslist`
    }
  } catch {}

  // .browserslistrc or browserslist
  const candidates = [
    '.browserslistrc',
    'browserslist',
    '.browserslistrc.json',
    '.browserslistrc.yaml',
    '.browserslistrc.yml'
  ]
  for (const file of candidates) {
    const p = path.join(projectPath, file)
    if (fs.existsSync(p)) return p
  }
  return undefined
}
