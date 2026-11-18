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
import {isGeckoBasedBrowser} from '../lib/constants'
import {resolveDevelopDistFile} from '../lib/develop-context'
import {extensionSchemeFor} from '../lib/extension-base-from-stack'
import {hasDependency} from '../lib/has-dependency'
import {filterKeysForThisBrowser} from '../lib/manifest-utils'
import {debugLine, isDebug} from '../lib/messaging'
import {parseAuthoredJson} from '../lib/parse-json-safe'
import {toResourceKey} from '../lib/resource-path'
import {NOT_RAW_RESOURCE_QUERY} from '../lib/resource-query'
import {publicContainmentRoot} from '../plugin-special-folders/resolve-public-folder'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../plugin-web-extension/feature-scripts/contracts'
import {extensionBaseAttributeFor} from '../plugin-web-extension/feature-scripts/scripts-lib/taken-extension-base'
import {resolveScriptEntryPath} from '../plugin-web-extension/feature-scripts/scripts-lib/utils'
import type {DevOptions, Manifest, PluginInterface} from '../types'
import {usesStyleTools} from './common-style-loaders'
import {cssInContentScriptLoader} from './css-in-content-script-loader'
import {cssInHtmlLoader} from './css-in-html-loader'
import {cssUrlRefFiles, toPosixPath} from './css-lib/dead-url-refs'
import * as messages from './css-lib/messages'
import {
  SFC_INLINE_STYLE_BLOCK_QUERY,
  SFC_MODULE_STYLE_BLOCK_QUERY,
  SFC_STYLE_BLOCK_QUERY,
  SVELTE_STYLE_BLOCK_TEST
} from './css-lib/sfc-style-block'
import {
  beginStyleDiagnostics,
  reportStyleDiagnostic
} from './css-lib/style-diagnostics'
import {
  forgetVerbatimCss,
  minifierDroppedTokens,
  restoreVerbatimCssAssets,
  verbatimCssIdsIn
} from './css-lib/verbatim-css'
import {maybeUseLess} from './css-tools/less'
import {
  findIgnoredPostCssConfigs,
  findPostCssConfig,
  type PostCssCompilerReader,
  postCssConfigHelpers,
  postCssReaderForOneCompiler,
  postCssSetupFiles
} from './css-tools/postcss'
import {maybeUseSass} from './css-tools/sass'
import {getTailwindConfigFile} from './css-tools/tailwind'
import {PUBLIC_ROOT_SCHEME} from './public-css-url-loader'

export class CssPlugin {
  public static readonly name: string = 'plugin-css'

  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']

  // Setup failures found while building the rules, said once per compiler.
  private readonly setupWarnings: string[] = []

  // The compiler's one reader of the PostCSS config, kept to read it again.
  private postCss: PostCssCompilerReader | undefined

  // Whether the rules were built for a project that uses a style tool.
  private usedStyleTools = false

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  private async configureOptions(compiler: Compiler) {
    const mode: DevOptions['mode'] =
      (compiler.options.mode as DevOptions['mode']) || 'development'
    const projectPath = (compiler.options.context as string) || process.cwd()

    const manifestPath = this.manifestPath
    const usingSass = hasDependency(projectPath, 'sass')
    const usingLess = hasDependency(projectPath, 'less')

    beginStyleDiagnostics(projectPath, String(mode))

    // Two main loaders: cssInContentScriptLoader (assets) and cssInHtmlLoader.
    // The optional-package contract resolves sass/less before the chain runs.
    await maybeUseSass(projectPath)
    await maybeUseLess(projectPath)

    const sfcOptions = {
      manifestPath,
      projectPath,
      ...(isGeckoBasedBrowser(String(this.browser)) ? {gecko: true} : {}),
      baseAttribute: extensionBaseAttributeFor(manifestPath, this.browser),
      baseScheme: extensionSchemeFor(String(this.browser))
    }

    // A reading that repeats what the one before it said adds nothing, in
    // this compiler or in the one a dev session opened before it.
    this.postCss = postCssReaderForOneCompiler((message) => {
      reportStyleDiagnostic(projectPath, message, (told) =>
        this.setupWarnings.push(told)
      )
    })

    const reread = this.postCss.reread

    this.postCss.reread = () => {
      beginStyleDiagnostics(projectPath, String(mode))

      return reread()
    }

    this.usedStyleTools = usesStyleTools(projectPath)

    const usage = {
      useSass: usingSass,
      useLess: usingLess,
      postCss: this.postCss
    }

    for (const {file, rename} of findIgnoredPostCssConfigs(projectPath)) {
      this.setupWarnings.push(messages.postCssConfigNameIgnored(file, rename))
    }

    const loaders: RuleSetRule[] = [
      ...(await cssInContentScriptLoader(
        projectPath,
        manifestPath,
        mode,
        usage,
        this.browser
      )),
      ...(await cssInHtmlLoader(projectPath, mode, manifestPath, usage)),
      // Post, so it runs after the framework has scoped the block. The block
      // is imported for its effect alone, which sideEffects: false would drop.
      {
        enforce: 'post',
        issuerLayer: EXTENSIONJS_CONTENT_SCRIPT_LAYER,
        resourceQuery: SFC_STYLE_BLOCK_QUERY,
        sideEffects: true,
        loader: resolveDevelopDistFile('sfc-style-block-loader'),
        options: sfcOptions
      },
      // Svelte's block has no query: its name is the whole signal.
      {
        enforce: 'post',
        issuerLayer: EXTENSIONJS_CONTENT_SCRIPT_LAYER,
        test: SVELTE_STYLE_BLOCK_TEST,
        sideEffects: true,
        loader: resolveDevelopDistFile('sfc-style-block-loader'),
        options: sfcOptions
      },
      // The request for an inline block answers with a one-line proxy to the
      // request that compiles it, where the component expects the block's text.
      {
        enforce: 'post',
        issuerLayer: {not: EXTENSIONJS_CONTENT_SCRIPT_LAYER},
        resourceQuery: SFC_INLINE_STYLE_BLOCK_QUERY,
        loader: resolveDevelopDistFile('sfc-style-block-loader'),
        options: sfcOptions
      },
      // <style module>: the request the component makes re-exports the class
      // names of a CSS module, so it runs as JavaScript in every layer.
      {
        test: /\.(css|sass|scss|less)$/,
        resourceQuery: SFC_MODULE_STYLE_BLOCK_QUERY,
        type: 'javascript/auto'
      },
      {
        enforce: 'post',
        issuerLayer: {not: EXTENSIONJS_CONTENT_SCRIPT_LAYER},
        resourceQuery: SFC_MODULE_STYLE_BLOCK_QUERY,
        loader: resolveDevelopDistFile('sfc-style-block-loader'),
        options: sfcOptions
      },
      // Pre, so it reads the script as authored. A sheet imported for its
      // effect alone becomes an unread value here, which the build says once.
      {
        enforce: 'pre',
        test: /\.(js|cjs|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/,
        exclude: [/([\\/])node_modules\1/],
        issuerLayer: EXTENSIONJS_CONTENT_SCRIPT_LAYER,
        resourceQuery: NOT_RAW_RESOURCE_QUERY,
        loader: resolveDevelopDistFile('unplaced-style-import-loader'),
        options: {
          projectPath,
          declaredEntries: findDeclaredContentScriptFiles(
            manifestPath,
            this.browser,
            projectPath
          )
        }
      },
      // ?inline stylesheet imports (vue-loader emits them for *.ce.vue) must resolve
      // to the CSS string default export; this rule only flips the module type.
      {
        test: /\.(css|sass|scss|less)$/,
        resourceQuery: /(\?|&)inline(&|$)/,
        type: 'asset/source'
      }
    ]

    // [name] is the entry name, or the chunk id for an unnamed split chunk,
    // so every sheet gets its own file without a hash in dev and production.
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

      debugLine(messages.cssIntegrationsEnabled(integrations))

      const postcssConfig = findPostCssConfig(projectPath)
      const tailwindConfig = getTailwindConfigFile(projectPath)
      const browserslistSource = findBrowserslistSource(projectPath)

      debugLine(
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
    // The registry outlives a compilation, so each compiler drops the sheets
    // it no longer emits, and never one another compiler may still emit.
    let idsInUse = new Set<string>()

    compiler.hooks.thisCompilation.tap(`${CssPlugin.name}:parity`, (c) => {
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
          const ids = verbatimCssIdsIn(c)
          const restored = new Set(restoreVerbatimCssAssets(c))

          forgetVerbatimCss([...idsInUse].filter((id) => !ids.has(id)))
          idsInUse = ids

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

  // A page sheet's url() to a file public/ owns left the loader chain behind
  // a scheme rspack does not request; the emitted sheet names the root path.
  private restorePublicRootRefs(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(`${CssPlugin.name}:public`, (c) => {
      c.hooks.processAssets.tap(
        {
          name: `${CssPlugin.name}:public-root-restore`,
          stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE + 2
        },
        () => {
          for (const asset of c.getAssets()) {
            if (!/\.(css|js)$/.test(asset.name)) continue

            const before = asset.source.source().toString()
            let at = before.indexOf(PUBLIC_ROOT_SCHEME)
            if (at === -1) continue

            // Cut in place, so the sheet keeps the source map it came with.
            const restored = new sources.ReplaceSource(asset.source)

            while (at !== -1) {
              restored.replace(at, at + PUBLIC_ROOT_SCHEME.length - 1, '')
              at = before.indexOf(PUBLIC_ROOT_SCHEME, at + 1)
            }

            c.updateAsset(asset.name, restored)
          }
        }
      )
    })
  }

  // A url() to a nonexistent file is fatal to rspack but Chrome 404s it silently
  // and applies the rest: cancel and warn. EXTENSION_STRICT_REFS makes it an error.
  private tolerateDeadUrlRefs(compiler: Compiler) {
    const manifestDir = path.dirname(this.manifestPath)
    const projectPath = (compiler.options.context as string) || process.cwd()
    let roots = [manifestDir]
    let compilation: import('@rspack/core').Compilation | null = null
    const warned = new Set<string>()

    compiler.hooks.thisCompilation.tap(`${CssPlugin.name}:dead-url`, (c) => {
      compilation = c
      warned.clear()
      // The folder the copier ships from, which `folders` can move.
      roots = [
        publicContainmentRoot(this.manifestPath, projectPath),
        manifestDir
      ]
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

            // A request with loader syntax (`!=!` inline match resource, `-!`
            // or `!!` prefixes) is a module request some loader built, never
            // a url() to a file. vue-loader re-issues each <style> block this
            // way from a `.vue.css` issuer; cancelling it drops the block.
            if (raw.includes('!')) return

            const issuerDir = String(data?.context || path.dirname(issuer))
            const candidates = cssUrlRefFiles(raw, {issuerDir, roots})
            if (candidates.length === 0) return

            const req = raw.split('?')[0].split('#')[0]

            if (candidates.some((candidate) => fs.existsSync(candidate))) {
              return
            }

            // Cancelled before rspack resolves it, so nothing watches for the
            // file. Watch every place it could appear, or a later write is lost.
            compilation?.missingDependencies.addAll(candidates)

            const key = `${issuer}|${req}`

            // Strict refs fails the build here, under the same name and code.
            // Left to rspack, a relative one came back as a warning.
            const strict = process.env.EXTENSION_STRICT_REFS === 'true'
            const sink = strict ? compilation?.errors : compilation?.warnings

            if (!warned.has(key) && sink) {
              warned.add(key)
              const issuerPath = toPosixPath(
                path.relative(manifestDir, issuer) || issuer
              )
              const report = new WebpackError(
                messages.deadCssUrlRef(issuerPath, raw, strict)
              )
              ;(report as Error & {file?: string}).file = issuerPath
              report.name = 'CssDeadRef'
              sink.push(report)
            }

            return false
          }
        )
      }
    )
  }

  // A dev session reads the PostCSS setup when it starts. An edit to one of
  // its files is read again here, so the next build compiles with it.
  private rereadPostCssSetupOnChange(
    compiler: Compiler,
    configured: Promise<void>
  ) {
    const projectPath = (compiler.options.context as string) || process.cwd()
    const files = postCssSetupFiles(projectPath).map((file) =>
      path.resolve(file)
    )
    // The project files a config requires are known once it was read.
    const setupFiles = () => [...files, ...postCssConfigHelpers(projectPath)]
    let needsRestart: string | undefined

    compiler.hooks.watchRun.tapPromise(`${CssPlugin.name}:setup`, async () => {
      await configured

      const watched = new Set(setupFiles())
      const changed = [
        ...(compiler.modifiedFiles || []),
        ...(compiler.removedFiles || [])
      ].find((file) => watched.has(path.resolve(file)))

      if (!changed || !this.postCss) return

      // Rules built with no style tool hold no PostCSS step to update, and
      // the same goes for a step that would now appear or go away.
      const applied =
        usesStyleTools(projectPath) === this.usedStyleTools &&
        (await this.postCss.reread())

      if (!applied) needsRestart = path.resolve(changed)
    })

    compiler.hooks.thisCompilation.tap(`${CssPlugin.name}:setup-files`, (c) => {
      // A project with no sheet yet has no module that watches these.
      for (const file of setupFiles()) {
        if (fs.existsSync(file)) c.fileDependencies.add(file)
        else c.missingDependencies.add(file)
      }

      if (!needsRestart) return

      const warning = new compiler.rspack.WebpackError(
        messages.postCssConfigNeedsRestart(needsRestart)
      )

      needsRestart = undefined
      warning.name = 'CssSetupWarning'
      c.warnings.push(warning)
    })
  }

  private reportSetupWarnings(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(`${CssPlugin.name}:setup`, (c) => {
      for (const message of this.setupWarnings.splice(0)) {
        const warning = new compiler.rspack.WebpackError(message)

        warning.name = 'CssSetupWarning'
        c.warnings.push(warning)
      }
    })
  }

  public async apply(compiler: Compiler) {
    this.reportSetupWarnings(compiler)
    this.keepCssParityInProduction(compiler)
    this.restorePublicRootRefs(compiler)
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
    this.rereadPostCssSetupOnChange(compiler, configuring)
    await configuring
  }
}

// The files a manifest content_scripts group names, as the build resolves them.
export function findDeclaredContentScriptFiles(
  manifestPath: string,
  browser: DevOptions['browser'],
  projectPath: string
): string[] {
  try {
    const manifest = filterKeysForThisBrowser(
      parseAuthoredJson(fs.readFileSync(manifestPath, 'utf8')) as Manifest,
      browser
    )
    const groups = Array.isArray(manifest.content_scripts)
      ? (manifest.content_scripts as Array<{js?: unknown}>)
      : []
    const manifestDir = path.dirname(manifestPath)

    return groups
      .flatMap((group) => (Array.isArray(group?.js) ? group.js : []))
      .filter((file): file is string => typeof file === 'string' && !!file)
      .map((file) =>
        toResourceKey(resolveScriptEntryPath(file, manifestDir, projectPath))
      )
  } catch {
    return []
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
