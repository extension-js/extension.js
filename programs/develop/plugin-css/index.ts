//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {WebpackError, type Compiler, type RuleSetRule} from '@rspack/core'
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
      })),
      // `?inline` stylesheet imports (vue-loader emits them for every <style>
      // in a *.ce.vue custom-element SFC; Vite exposes the same convention)
      // must resolve to the processed CSS as the module's default string
      // export. The issuer-based rules above type these requests as native
      // CSS — a module with no JS exports — which dead-links the importer's
      // default import. Appended last with no `use`, this rule only flips the
      // module type; the matching rules above still contribute the full
      // PostCSS/Sass/Less loader chain exactly once.
      {
        test: /\.(css|sass|scss|less)$/,
        resourceQuery: /(\?|&)inline(&|$)/,
        type: 'asset/source'
      }
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

  /**
   * A stylesheet url() whose file exists nowhere in the project is a fatal
   * "Module not found" to rspack's CSS parser, but Chrome applies the rest
   * of the stylesheet and 404s the reference silently (wild:
   * mozilla/contain-facebook ships url(/img/login_continue_*.png) with no
   * such files anywhere — the extension is store-published and works).
   * Cancel these requests before resolution and warn instead, mirroring the
   * dead-HTML-ref policy; EXTENSION_STRICT_REFS=true keeps them fatal.
   * Only unambiguous file refs are tolerated — '/x' (extension root),
   * './x'/'../x' (issuer-relative), and bare paths with a non-CSS asset
   * extension. Bare specifiers without one stay with the resolver so
   * node_modules @imports keep failing loudly when genuinely broken.
   */
  private tolerateDeadUrlRefs(compiler: Compiler) {
    const manifestDir = path.dirname(this.manifestPath)
    const projectPath = (compiler.options.context as string) || process.cwd()
    const roots = [path.join(projectPath, 'public'), manifestDir]
    const assetExt =
      /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp|cur|woff2?|ttf|otf|eot|mp3|mp4|webm|ogg|wav)$/i
    let compilation: any = null
    const warned = new Set<string>()

    // Minimal/mock compilers in specs don't carry these hooks.
    if (
      !compiler.hooks?.thisCompilation?.tap ||
      !(compiler.hooks as any)?.normalModuleFactory?.tap
    ) {
      return
    }

    compiler.hooks.thisCompilation.tap(`${CssPlugin.name}:dead-url`, (c) => {
      compilation = c
      warned.clear()
    })

    compiler.hooks.normalModuleFactory.tap(
      `${CssPlugin.name}:dead-url`,
      (nmf: any) => {
        nmf.hooks.beforeResolve.tap(`${CssPlugin.name}:dead-url`, (data: any) => {
          const issuer = String(data?.contextInfo?.issuer || '').split('?')[0]
          if (!/\.(css|scss|sass|less)$/i.test(issuer)) return

          const raw = String(data?.request || '')
          const req = raw.split('?')[0].split('#')[0]
          if (!req || req.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(req)) {
            return
          }
          if (req.startsWith('~') || req.startsWith('@')) return

          const isRootRef = req.startsWith('/')
          const isRelativeRef = req.startsWith('./') || req.startsWith('../')
          const isBareAssetRef =
            !isRootRef && !isRelativeRef && assetExt.test(req)
          if (!isRootRef && !isRelativeRef && !isBareAssetRef) return

          const issuerDir = data?.context || path.dirname(issuer)
          const candidates = isRootRef
            ? roots.map((root) => path.join(root, req.slice(1)))
            : [path.resolve(issuerDir, req), ...(isBareAssetRef ? roots.map((root) => path.join(root, req)) : [])]
          if (candidates.some((candidate) => fs.existsSync(candidate))) return
          if (process.env.EXTENSION_STRICT_REFS === 'true') return

          const key = `${issuer}|${req}`
          if (!warned.has(key) && compilation?.warnings) {
            warned.add(key)
            const warning = new WebpackError(
              messages.deadCssUrlRef(
                path.relative(manifestDir, issuer) || issuer,
                raw
              )
            )
            ;(warning as any).file = path.relative(manifestDir, issuer)
            compilation.warnings.push(warning)
          }
          return false
        })
      }
    )
  }

  public async apply(compiler: Compiler) {
    this.tolerateDeadUrlRefs(compiler)
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
