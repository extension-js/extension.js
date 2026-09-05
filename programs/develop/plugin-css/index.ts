//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  Compilation,
  type Compiler,
  type RuleSetRule,
  sources,
  WebpackError
} from '@rspack/core'
import {hasDependency} from '../lib/has-dependency'
import {isDebug} from '../lib/messaging'
import type {DevOptions, PluginInterface} from '../types'
import {cssInContentScriptLoader} from './css-in-content-script-loader'
import {cssInHtmlLoader} from './css-in-html-loader'
import {toPosixPath} from './css-lib/dead-url-refs'
import * as messages from './css-lib/messages'
import {
  minifierDroppedTokens,
  restoreVerbatimCssAssets
} from './css-lib/verbatim-css'
import {maybeUseLess} from './css-tools/less'
import {findPostCssConfig} from './css-tools/postcss'
import {maybeUseSass} from './css-tools/sass'
import {getTailwindConfigFile} from './css-tools/tailwind'

export {injectCssLink} from './css-lib/inject-css-link'
export type {CssAssetResult} from './css-lib/resolve-css-asset'
// Re-export CSS utilities so other plugins can import from @plugin-css
export {resolveCssAsset} from './css-lib/resolve-css-asset'

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

    // Two main loaders: cssInContentScriptLoader (assets) and cssInHtmlLoader.
    // The optional-package contract resolves sass/less before the chain runs.
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
      // ?inline stylesheet imports (vue-loader emits them for *.ce.vue) must resolve
      // to the CSS string default export; this rule only flips the module type.
      {
        test: /\.(css|sass|scss|less)$/,
        resourceQuery: /(\?|&)inline(&|$)/,
        type: 'asset/source'
      }
    ]

    // Rspack's native CSS already bakes a content-hash into [name] for split CSS
    // chunks, so plain [name].css suffices in dev and production.
    compiler.options.output.cssFilename = '[name].css'
    compiler.options.output.cssChunkFilename = '[name].css'

    compiler.options.module.rules = [
      ...compiler.options.module.rules,
      ...loaders
    ].filter(Boolean)

    if (isDebug()) {
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

  // A sheet the parser rejected went through as a placeholder rule; once the
  // minimizer is done, the emitted asset becomes the sheet as authored.
  // Production keeps every rule development keeps: a sheet the parser
  // rejected comes back as authored once the minimizer is done, and a sheet
  // the minimizer error-recovered into fewer rules than the browser would
  // keep ships unminified, with a warning naming what it dropped.
  private keepCssParityInProduction(compiler: Compiler) {
    if (!compiler.hooks?.thisCompilation?.tap) return
    compiler.hooks.thisCompilation.tap(`${CssPlugin.name}:parity`, (c) => {
      if (!c?.hooks?.processAssets?.tap) return
      const beforeMinify = new Map<string, string>()
      c.hooks.processAssets.tap(
        {
          name: `${CssPlugin.name}:parity-snapshot`,
          stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE - 1
        },
        () => {
          for (const asset of c.getAssets()) {
            if (!asset.name.endsWith('.css')) continue
            beforeMinify.set(asset.name, asset.source.source().toString())
          }
        }
      )
      c.hooks.processAssets.tap(
        {
          name: `${CssPlugin.name}:parity-restore`,
          stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE + 1
        },
        () => {
          const restored = new Set(restoreVerbatimCssAssets(c))
          for (const asset of c.getAssets()) {
            if (!asset.name.endsWith('.css') || restored.has(asset.name)) {
              continue
            }
            const before = beforeMinify.get(asset.name)
            if (before === undefined) continue
            const after = asset.source.source().toString()
            if (after === before) continue
            const dropped = minifierDroppedTokens(before, after)
            if (dropped.length === 0) continue
            c.updateAsset(asset.name, new sources.RawSource(before))
            const warning = new WebpackError(
              messages.cssMinifierDroppedRules(asset.name, dropped)
            )
            ;(warning as Error & {file?: string}).file = asset.name
            c.warnings.push(warning)
          }
        }
      )
    })
  }

  // A url() to a nonexistent file is fatal to rspack but Chrome 404s it silently
  // and applies the rest; cancel and warn. EXTENSION_STRICT_REFS restores fatal.
  private tolerateDeadUrlRefs(compiler: Compiler) {
    const manifestDir = path.dirname(this.manifestPath)
    const projectPath = (compiler.options.context as string) || process.cwd()
    const roots = [path.join(projectPath, 'public'), manifestDir]
    const assetExt =
      /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp|cur|woff2?|ttf|otf|eot|mp3|mp4|webm|ogg|wav)$/i
    let compilation: import('@rspack/core').Compilation | null = null
    const warned = new Set<string>()

    // Minimal/mock compilers in specs don't carry these hooks.
    if (
      !compiler.hooks?.thisCompilation?.tap ||
      !(compiler.hooks as {normalModuleFactory?: {tap?: unknown}})
        ?.normalModuleFactory?.tap
    ) {
      return
    }

    compiler.hooks.thisCompilation.tap(`${CssPlugin.name}:dead-url`, (c) => {
      compilation = c
      warned.clear()
    })

    compiler.hooks.normalModuleFactory.tap(
      `${CssPlugin.name}:dead-url`,
      (nmf) => {
        nmf.hooks.beforeResolve.tap(
          `${CssPlugin.name}:dead-url`,
          (data: {
            contextInfo?: {issuer?: unknown}
            context?: unknown
            request?: unknown
          }) => {
            const issuer = String(data?.contextInfo?.issuer || '').split('?')[0]
            if (!/\.(css|scss|sass|less)$/i.test(issuer)) return

            const raw = String(data?.request || '')
            const req = raw.split('?')[0].split('#')[0]
            if (
              !req ||
              req.startsWith('//') ||
              /^[a-z][a-z0-9+.-]*:/i.test(req)
            ) {
              return
            }
            if (req.startsWith('~') || req.startsWith('@')) return

            const isRootRef = req.startsWith('/')
            const isRelativeRef = req.startsWith('./') || req.startsWith('../')
            const isBareAssetRef =
              !isRootRef && !isRelativeRef && assetExt.test(req)
            if (!isRootRef && !isRelativeRef && !isBareAssetRef) return

            const issuerDir = String(data?.context || path.dirname(issuer))
            const candidates = isRootRef
              ? roots.map((root) => path.join(root, req.slice(1)))
              : [
                  path.resolve(issuerDir, req),
                  ...(isBareAssetRef
                    ? roots.map((root) => path.join(root, req))
                    : [])
                ]
            if (candidates.some((candidate) => fs.existsSync(candidate))) return
            if (process.env.EXTENSION_STRICT_REFS === 'true') return

            const key = `${issuer}|${req}`
            if (!warned.has(key) && compilation?.warnings) {
              warned.add(key)
              const issuerPath = toPosixPath(
                path.relative(manifestDir, issuer) || issuer
              )
              const warning = new WebpackError(
                messages.deadCssUrlRef(issuerPath, raw)
              )
              ;(warning as Error & {file?: string}).file = issuerPath
              compilation?.warnings.push(warning)
            }
            return false
          }
        )
      }
    )
  }

  public async apply(compiler: Compiler) {
    // Parity first: a minimal compiler in a spec keeps one thisCompilation
    // tap, and the dead-url guard is the one those specs exercise.
    this.keepCssParityInProduction(compiler)
    this.tolerateDeadUrlRefs(compiler)
    const mode = compiler.options.mode || 'development'
    if (mode === 'production') {
      // build runs via compiler.run(), which awaits beforeRun before reading rules.
      compiler.hooks.beforeRun.tapPromise(CssPlugin.name, () =>
        this.configureOptions(compiler)
      )
      return
    }
    // dev/watch: configure eagerly and gate the first compilation on the one
    // promise from both hooks. watchRun covers the dev server; beforeRun covers
    // a one-shot development build (compiler.run), which otherwise read the
    // rules before the css rules existed and sent a manifest stylesheet entry
    // to the JavaScript parser.
    const configuring = this.configureOptions(compiler)
    compiler.hooks.beforeRun.tapPromise(CssPlugin.name, () => configuring)
    compiler.hooks.watchRun.tapPromise(CssPlugin.name, () => configuring)
    await configuring
  }
}

function findBrowserslistSource(projectPath: string): string | undefined {
  const packageJsonPath = path.join(projectPath, 'package.json')
  try {
    if (fs.existsSync(packageJsonPath)) {
      const raw = fs.readFileSync(packageJsonPath, 'utf8')
      const pkg = JSON.parse(raw || '{}')
      if (pkg?.browserslist) return `${packageJsonPath}#browserslist`
    }
  } catch {
    // Ignore
  }

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
