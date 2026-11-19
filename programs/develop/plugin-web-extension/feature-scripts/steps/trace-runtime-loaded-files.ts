// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  Compilation,
  type Compiler,
  DefinePlugin,
  EntryPlugin,
  javascript as rspackJavascript,
  library as rspackLibrary,
  sources,
  WebpackError
} from '@rspack/core'
import {
  isChromiumBasedBrowser,
  isGeckoBasedBrowser,
  isWebkitBasedBrowser
} from '../../../lib/constants'
import {resolveDevelopDistFile} from '../../../lib/develop-context'
import {filterKeysForThisBrowser} from '../../../lib/manifest-utils'
import {parseAuthoredJson} from '../../../lib/parse-json-safe'
import {importMetaUrlForEmitPath} from '../../../plugin-compilation/env'
import {
  excludedFiles,
  isExcludedEntry
} from '../../../plugin-special-folders/folders-config'
import {
  type CompileMode,
  getSpecialFoldersDataForProjectRoot
} from '../../../plugin-special-folders/get-data'
import {sourceFileMayShip} from '../../../plugin-special-folders/public-private-files'
import type {DevOptions, Manifest} from '../../../types'
import {webkitDroppedSurfacePages} from '../../feature-manifest/manifest-lib/webkit-unsupported-keys'
import {declaredResourceSource} from '../../feature-web-resources/web-resources-lib/resolve-war'
import {isClassicScript} from '../../shared/classic-concat'
import {
  keepPagePath,
  namesPagePath,
  pageServedAtAuthoredPath
} from '../../shared/kept-page-paths'
import {getResolvedManifestFieldsData} from '../../shared/manifest-fields'
import {
  createLocalImportResolver,
  isLocalScriptSource,
  type LocalImportResolver,
  readScriptText
} from '../../shared/script-graph'
import * as messages from '../messages'
import {INJECTED_CLASSIC_QUERY} from '../scripts-lib/completion-value'
import {
  climbsOutOfSheetRoot,
  noteInjectedSheetTarget,
  noteNamedInjectedSheet,
  notePublicInjectedSheet
} from '../scripts-lib/injected-sheet-urls'
import {keepCompletionValueOf} from './keep-completion-value'
import {
  blankComments,
  escapeRegExp,
  forgetBlankedSources,
  type ImportedModuleReader,
  isConstantReference,
  type LiteralLookup,
  literalLookup,
  pureStringLiteral,
  type ResolvedLiteral,
  readBalancedArgs,
  skipString,
  splitTopLevelArgs,
  unescapeStringBody
} from './source-literals'
import {
  extractPathLiterals,
  toRuntimePathReference
} from './warn-unshipped-runtime-assets'

export type {ImportedModuleReader} from './source-literals'

// Structural view of the manifest fields the tracer reads; values stay
// unknown and are validated at each use site.
interface TracedManifest {
  background?: {
    service_worker?: unknown
    page?: unknown
    scripts?: unknown[]
    type?: unknown
  }
  action?: {default_popup?: unknown}
  browser_action?: {default_popup?: unknown}
  page_action?: {default_popup?: unknown}
  options_page?: unknown
  options_ui?: {page?: unknown}
  devtools_page?: unknown
  side_panel?: {default_path?: unknown}
  sidebar_action?: {default_panel?: unknown}
  chrome_url_overrides?: Record<string, unknown>
  content_scripts?: Array<{js?: unknown[]; css?: unknown[]}>
  web_accessible_resources?: unknown
}

const EMITTED_WORKER_PATH = 'background/service_worker.js'
const EMITTED_BACKGROUND_SCRIPTS_PATH = 'background/scripts.js'
// Keys the browsers define. Strings under any other key ship verbatim in the
// output manifest, and extensions read them back with runtime.getManifest().
const STANDARD_MANIFEST_KEYS = new Set([
  'action',
  'app',
  'applications',
  'author',
  'automation',
  'background',
  'bluetooth',
  'browser_action',
  'browser_specific_settings',
  'chrome_settings_overrides',
  'chrome_url_overrides',
  'commands',
  'content_capabilities',
  'content_scripts',
  'content_security_policy',
  'converted_from_user_script',
  'cross_origin_embedder_policy',
  'cross_origin_opener_policy',
  'current_locale',
  'declarative_net_request',
  'default_locale',
  'description',
  'developer',
  'devtools_page',
  'dictionaries',
  'differential_fingerprint',
  'display_in_launcher',
  'display_in_new_tab_page',
  'event_rules',
  'export',
  'externally_connectable',
  'file_browser_handlers',
  'file_system_provider_capabilities',
  'homepage_url',
  'host_permissions',
  'icon_variants',
  'icons',
  'import',
  'incognito',
  'input_components',
  'key',
  'kiosk',
  'kiosk_enabled',
  'kiosk_only',
  'l10n',
  'manifest_version',
  'minimum_chrome_version',
  'minimum_edge_version',
  'minimum_opera_version',
  'nacl_modules',
  'name',
  'oauth2',
  'offline_enabled',
  'omnibox',
  'optional_host_permissions',
  'optional_permissions',
  'options_page',
  'options_ui',
  'page_action',
  'permissions',
  'platforms',
  'protocol_handlers',
  'replacement_web_app',
  'requirements',
  'sandbox',
  'short_name',
  'side_panel',
  'sidebar_action',
  'signature',
  'sockets',
  'storage',
  'system_indicator',
  'theme',
  'theme_experiment',
  'trial_tokens',
  'tts_engine',
  'update_url',
  'url_handlers',
  'usb_printers',
  'user_scripts',
  'version',
  'version_name',
  'web_accessible_resources',
  'webview'
])
const STANDARD_BACKGROUND_KEYS = new Set([
  'page',
  'persistent',
  'preferred_environment',
  'scripts',
  'service_worker',
  'type'
])
// importScripts chains resolve against the worker URL, so depth only grows
// through files importing further files, 8 hops is far beyond real usage.
const MAX_TRACE_DEPTH = 8
const FONT_FILE = /\.(?:woff2?|ttf|otf|eot)$/i
// The names a font license ships under, with any ending.
const LICENSE_FILE = /^(?:licen[sc]e|copying|notice)|^ofl\.txt$/i
const SCRIPT_SRC = /<script\b[^>]*?\bsrc\s*=\s*(["'])([^"']+)\1/gi
const SOURCE_SIBLING_EXTENSIONS = ['.ts', '.mts', '.tsx', '.jsx', '.mjs']
const STYLESHEET_SIBLING_EXTENSIONS = ['.scss', '.sass', '.less']
// Sources the compiler rewrites to .js: a runtime literal naming one asks the
// browser for a path the build never emits.
const COMPILED_TO_JS_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.jsx',
  '.mts',
  '.cts',
  '.mtsx',
  '.mjsx',
  '.mjs',
  '.cjs'
])
// Spellings the browser will not execute at all (Chrome serves .ts as
// video/mp2t and refuses it as a script), unlike .mjs and .cjs.
const SOURCE_ONLY_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.jsx',
  '.mts',
  '.cts',
  '.mtsx',
  '.mjsx'
])
const SCRIPT_EXTENSIONS = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.jsx',
  '.mjsx',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.mtsx'
])

// Where a traced literal was found, which fixes how the browser executes it.
export type LoadContext = 'importScripts' | 'injected' | 'getURL' | 'html'
// importScripts and injection payloads always run as classic scripts. A getURL
// or HTML target is loaded the way its author wrote it, so the file decides.
export type TracedLoad = 'classic' | 'by-shape'
export type TracedFormat = 'module' | 'classic'

export type TracedFilePlan =
  | {kind: 'copy'; sourcePath: string; emitPath: string}
  | {
      kind: 'compile'
      sourcePath: string
      emitPath: string
      format: TracedFormat
      spelledAs?: string
    }
  | {kind: 'skip'; reason: 'emitted' | 'public'; emitPath: string}
  | {
      kind: 'skip'
      reason: 'compiled-elsewhere'
      emitPath: string
      spelledAs: string
    }
  | {kind: 'missing'; emitPath: string}

export interface CompileRequest {
  sourcePath: string
  emitPath: string
  format: TracedFormat
  context: LoadContext
}

// The two handles a child compilation needs. TraceRun satisfies it, and so
// does any other plugin holding a compilation.
interface CompileHost {
  compilation: Compilation
  compiler: Compiler
}

interface ApplyContext {
  context: LoadContext
  onMissing: () => void
  onSourceSpelling: (emitPath: string, spelledAs: string) => void
  // The file exists and the build may not copy it. Left out, the miss speaks.
  onWithheld?: () => void
}

export class TraceRuntimeLoadedFiles {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  private readonly namingSources = new Map<string, string>()

  constructor(options: {
    manifestPath: string
    browser?: DevOptions['browser']
  }) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      TraceRuntimeLoadedFiles.name,
      (compilation) => {
        // SUMMARIZE runs after minification: copied files stay verbatim
        // (classic scripts share globals) and the scan sees final user bundles.
        compilation.hooks.processAssets.tapPromise(
          {
            name: TraceRuntimeLoadedFiles.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
          },
          async () => {
            const run = new TraceRun(
              compilation,
              compiler,
              path.dirname(this.manifestPath)
            )
            // Sources that need the bundler are compiled once per round, then
            // their output is scanned like any other bundle, since a compiled
            // file can itself load further files at runtime.
            let only: Set<string> | undefined

            try {
              for (let round = 0; round <= MAX_TRACE_DEPTH; round++) {
                if (!only) this.traceManifestNamedFiles(run)

                this.traceWorkerImportScripts(run, only)
                this.traceInjectedFilePayloads(run, only)
                this.traceFetchedFiles(run, only)
                this.traceGetURLFiles(run, only)
                this.keepAuthoredPagePaths(run, only)
                this.traceKeptPageFetches(run, only)
                this.traceNamedFiles(run, only)
                this.traceWebpackChunkSiblings(run, only)
                const emitted = await run.flushCompiles()
                if (emitted.length === 0) break

                only = new Set(emitted)
              }
            } finally {
              forgetBlankedSources()
            }
          }
        )
      }
    )
  }

  private readManifest(): TracedManifest | undefined {
    try {
      // A popup or worker declared under a browser prefix is invisible to a
      // raw read: the popup then ships twice and the worker's imports go untraced.
      return filterKeysForThisBrowser(
        parseAuthoredJson(
          fs.readFileSync(this.manifestPath, 'utf-8')
        ) as Manifest,
        this.browser
      ) as TracedManifest
    } catch {
      return undefined
    }
  }

  // A worker that calls importScripts.apply(null, getManifest().background.X)
  // names its files under a custom manifest key, so those files ship too.
  private traceManifestNamedFiles(run: TraceRun) {
    const manifest = this.readManifest() as Record<string, unknown> | undefined
    if (!manifest) return

    const seen = run.seen.getURL

    for (const {key, literal} of customManifestFileReferences(manifest)) {
      const distRel = resolveExtensionPath(literal, '')
      if (!distRel || seen.has(distRel)) continue

      const plan = run.plan({
        sourceRel: distRel,
        distRel,
        loadsAs: 'by-shape'
      })
      // A string under a custom key is a file only when one exists at that
      // path. Anything else is the extension's own data and stays untouched.
      if (plan.kind === 'missing') continue

      seen.add(distRel)

      run.apply(plan, {
        context: 'getURL',
        onMissing: () => {},
        onSourceSpelling: () => {},
        // The value names a real file, so the build says why it is absent.
        onWithheld: () =>
          run.warn(
            'ManifestNamedFileNotShipped',
            'manifest.json',
            messages.manifestNamedFileNotShipped(key, literal, distRel)
          )
      })
    }
  }

  private traceWorkerImportScripts(run: TraceRun, only?: Set<string>) {
    const manifest = this.readManifest()
    const workerRef = manifest?.background?.service_worker
    // Module workers cannot legally call importScripts.
    if (!workerRef || manifest?.background?.type === 'module') return

    const workerAsset = run.compilation.getAsset(EMITTED_WORKER_PATH)
    if (!workerAsset) return

    const sourceWorkerPath = unixify(String(workerRef)).replace(/^\/+/, '')
    // Later rounds scan the deps compiled for the worker in the previous
    // round; copied deps chain inline below since their text is at hand.
    const roots = only
      ? [...only].filter((name) => run.workerScope.has(name))
      : [EMITTED_WORKER_PATH]

    let pending: string[] = []

    for (const name of roots) {
      const asset = run.compilation.getAsset(name)
      if (asset) pending.push(run.textOf(asset))
    }

    const seen = run.seen.importScripts

    for (let depth = 0; depth < MAX_TRACE_DEPTH && pending.length; depth++) {
      const next: string[] = []

      for (const content of pending) {
        // A path a constant names is held to what a literal is. A path
        // only listed is a guess, kept when it is a file.
        const {named, candidates} = importScriptsVariablePaths(content)
        const listed = candidates.filter((literal) => {
          const rel = resolveExtensionPath(literal, sourceWorkerPath)

          return Boolean(rel) && isFile(path.join(run.manifestDir, String(rel)))
        })

        for (const literal of [
          ...extractImportScriptsLiterals(content),
          ...named,
          ...listed
        ]) {
          const sourceRel = resolveExtensionPath(literal, sourceWorkerPath)
          const distRel = resolveExtensionPath(literal, EMITTED_WORKER_PATH)
          if (!sourceRel || !distRel || seen.has(distRel)) continue

          seen.add(distRel)

          const plan = run.plan({sourceRel, distRel, loadsAs: 'classic'})
          const copied = run.apply(plan, {
            context: 'importScripts',
            onMissing: () =>
              run.warn(
                'ImportScriptsDependencyMissing',
                EMITTED_WORKER_PATH,
                messages.importScriptsDependencyMissing(
                  sourceWorkerPath,
                  literal,
                  sourceRel
                )
              ),
            onSourceSpelling: (emitPath) =>
              run.warn(
                'ImportScriptsCompiledSource',
                EMITTED_WORKER_PATH,
                messages.compiledSourceSpelling(
                  EMITTED_WORKER_PATH,
                  'importScripts',
                  literal,
                  emitPath
                )
              )
          })

          // Imported classic scripts may chain further importScripts calls;
          // those still resolve against the worker URL, not the file's own.
          if (copied != null) {
            next.push(copied)
            run.workerScope.add(distRel)
          }

          // wasm-bindgen --target no-modules pairs X.js with X_bg.wasm via a
          // computed fetch, so copy the sibling through when it exists.
          if (
            plan.kind !== 'missing' &&
            !run.withheld.has(distRel) &&
            sourceRel.endsWith('.js')
          ) {
            run.copySibling(
              path.join(
                run.manifestDir,
                sourceRel.replace(/\.js$/, '_bg.wasm')
              ),
              distRel.replace(/\.js$/, '_bg.wasm')
            )
          }
        }
      }

      pending = next
    }
  }

  // fetch() reads bytes, so a fetched file is data whatever its extension and
  // is always copied as-is.
  private traceFetchedFiles(run: TraceRun, only?: Set<string>) {
    const {compilation, manifestDir} = run
    const seen = run.seen.fetched

    // fetch() resolves against the PAGE URL, and pages get relocated in dist,
    // so the entry's source dir approximates the author's lost relative base.
    const entrySourceDirs = run.entrySourceDirs

    // Content scripts (and injected scripts/ helpers) run inside web pages,
    // where a relative fetch() resolves against the WEBSITE, untraceable.
    const jsAssets = run
      .jsAssets(only)
      .filter(
        (asset) =>
          !asset.name.startsWith('content_scripts/') &&
          !asset.name.startsWith('scripts/')
      )

    for (const asset of jsAssets) {
      const content = run.textOf(asset)

      for (const literal of extractFetchedFileLiterals(content)) {
        // Runtime resolution base is the asset's own URL directory: page
        // scripts sit beside their page in dist, workers fetch off the worker URL.
        const distRel = resolveExtensionPath(literal, ownAddressOf(asset.name))
        if (!distRel || seen.has(distRel)) continue

        seen.add(distRel)

        if (compilation.getAsset(distRel)) continue
        // public/ files land at the output root via the special-folders
        // pipeline.
        if (fs.existsSync(path.join(manifestDir, 'public', distRel))) continue

        const fsRel = fetchLiteralToFsPath(literal)
        const rootRel = resolveExtensionPath(literal, '')
        const entryDir = entrySourceDirs.get(asset.name.replace(/\.js$/i, ''))
        const candidates = [
          // Source layout already mirrors the emitted layout.
          path.join(manifestDir, distRel),
          // Author-relative to the (relocated) page's source dir.
          entryDir && fsRel && !fsRel.startsWith('/')
            ? path.resolve(entryDir, fsRel)
            : null,
          // Author-relative to the extension root (Chrome clamps ../ at the
          // origin root, so this matches real resolution for root pages).
          rootRel ? path.join(manifestDir, rootRel) : null
        ].filter((candidate): candidate is string => Boolean(candidate))

        const abs = candidates.find(
          (candidate) =>
            !path.relative(manifestDir, candidate).startsWith('..') &&
            isFile(candidate)
        )

        // Only extensioned paths warn: a bare "/v1/users"-style literal is far
        // likelier an API route than a file the author expected in the package.
        const missing = /\.[a-zA-Z0-9]{1,8}$/.test(distRel)
          ? () =>
              run.warn(
                'RuntimeFetchedFileMissing',
                asset.name,
                messages.fetchedFileDependencyMissing(
                  asset.name,
                  literal,
                  distRel
                )
              )
          : undefined

        if (abs) {
          run.emitCopy(
            abs,
            distRel,
            missing ?? run.sayNotShipped(asset.name, literal, distRel)
          )

          continue
        }

        missing?.()
      }
    }
  }

  // The page each manifest surface names, by the path the author wrote it
  // at, to the path the page pipeline emits it under.
  // The hint names where the file would resolve from, relative to the
  // project, and says so when it already exists outside the manifest folder.
  private missingFileHint(
    run: TraceRun,
    distRel: string
  ): {expectedPath: string; foundOutside?: string} {
    const projectPath =
      (run.compilation.options?.context as string | undefined) ??
      run.manifestDir
    const expectedPath =
      unixify(
        path.relative(projectPath, path.join(run.manifestDir, distRel))
      ) || distRel
    const outside = path.join(projectPath, distRel)
    const foundOutside =
      path.relative(run.manifestDir, outside).startsWith('..') &&
      fs.existsSync(outside)
        ? unixify(path.relative(projectPath, outside))
        : undefined

    return {expectedPath, foundOutside}
  }

  private surfacePageOutputs(manifestDir: string): Map<string, string> {
    const outputs = new Map<string, string>()

    try {
      const pages = getResolvedManifestFieldsData({
        manifestPath: this.manifestPath,
        browser: this.browser
      }).html as Record<string, string | undefined>

      for (const [feature, source] of Object.entries(pages)) {
        if (!source) continue

        const sourceRel = unixify(path.relative(manifestDir, source))
        if (sourceRel.startsWith('..')) continue

        outputs.set(sourceRel, `${feature}.html`)
      }
    } catch {
      // A manifest the fields reader rejects has no surface pages to copy.
    }

    return outputs
  }

  // Every page the build compiles away from the path its author wrote, with
  // each compiled page that source feeds. The background page is not one.
  private relocatedPageOutputs(manifestDir: string): Map<string, string[]> {
    const relocated = new Map<string, string[]>()

    try {
      const pages = getResolvedManifestFieldsData({
        manifestPath: this.manifestPath,
        browser: this.browser
      }).html as Record<string, string | undefined>

      for (const [feature, source] of Object.entries(pages)) {
        if (!source || feature === 'background/index') continue

        const authored = unixify(path.relative(manifestDir, source))
        const output = `${feature}.html`
        if (authored.startsWith('..') || authored === output) continue

        relocated.set(authored, [...(relocated.get(authored) ?? []), output])
      }
    } catch {
      // A manifest the fields reader rejects moves no page.
    }

    return relocated
  }

  // Every page the pages/ folder compiles under a name other than the path
  // its author wrote, such as pages/x/index.html built as pages/x.html.
  private folderPageOutputs(run: TraceRun): Map<string, string> {
    const outputs = new Map<string, string>()

    try {
      const pages =
        getSpecialFoldersDataForProjectRoot(
          (run.compiler.options?.context as string | undefined) ||
            run.manifestDir,
          undefined,
          run.compiler.options?.mode as CompileMode | undefined
        ).pages ?? {}

      for (const [feature, source] of Object.entries(pages)) {
        if (typeof source !== 'string') continue

        const authored = unixify(path.relative(run.manifestDir, source))
        const output = `${feature}.html`
        if (authored.startsWith('..') || authored === output) continue

        outputs.set(authored, output)
      }
    } catch {
      // A folder that cannot be read has no page to serve.
    }

    return outputs
  }

  // A script that holds the path a page was written at compares it with
  // sender.url or location, so the page has to open at that same path.
  private keepAuthoredPagePaths(run: TraceRun, only?: Set<string>) {
    const relocated = this.relocatedPageOutputs(run.manifestDir)
    if (relocated.size === 0) return

    for (const asset of run.jsAssets(only)) {
      const text = run.textOf(asset)
      const mentioned = [...relocated.keys()].filter((authored) =>
        text.includes(authored)
      )
      if (mentioned.length === 0) continue

      const literals = extractPathLiterals(blankComments(text))

      for (const authored of mentioned) {
        const literal = literals.find((value) => namesPagePath(value, authored))
        if (!literal) continue

        const outputs = relocated.get(authored) ?? []
        if (!servePageAtAuthoredPath(run, authored, outputs)) continue

        // Read once per session: a dev rebuild keeps the page the same way.
        const mentionedIn =
          this.namingSources.get(literal) ??
          run.sourceNaming(literal) ??
          asset.name

        this.namingSources.set(literal, mentionedIn)

        for (const output of outputs) {
          if (!run.hasAsset(output)) continue

          keepPagePath(run.compilation, {output, authored, mentionedIn})
        }
      }
    }
  }

  // A kept page asks from the folder its author wrote it in, so a relative
  // fetch in its scripts reads the layout of the source folder.
  private traceKeptPageFetches(run: TraceRun, only?: Set<string>) {
    if (run.servedPages.size === 0) return

    const pages = run.pagesLoadingScripts()
    const seen = run.seen.fetched

    for (const asset of run.jsAssets(only)) {
      const bases = (pages.get(asset.name) ?? []).filter((page) =>
        run.servedPages.has(page)
      )
      if (bases.length === 0) continue

      for (const literal of extractFetchedFileLiterals(run.textOf(asset))) {
        for (const base of bases) {
          const distRel = resolveExtensionPath(literal, base)
          if (!distRel || seen.has(distRel)) continue

          seen.add(distRel)

          if (run.hasAsset(distRel)) continue
          if (isFile(path.join(run.manifestDir, 'public', distRel))) continue

          const abs = path.join(run.manifestDir, distRel)

          if (isFile(abs)) {
            run.emitCopy(
              abs,
              distRel,
              run.sayNotShipped(asset.name, literal, distRel)
            )
          }
        }
      }
    }
  }

  // The root paths web_accessible_resources files ship at: a sibling folder
  // file the WAR step emits later in the compilation is not missing.
  private webAccessibleOutputs(run: TraceRun): Set<string> {
    const outputs = new Set<string>()
    const declared = this.readManifest()?.web_accessible_resources
    if (!Array.isArray(declared)) return outputs

    const projectPath = run.compilation.options?.context as string | undefined

    for (const entry of declared) {
      const resources =
        typeof entry === 'string'
          ? [entry]
          : Array.isArray(entry?.resources)
            ? entry.resources
            : []

      for (const resource of resources) {
        if (typeof resource !== 'string') continue

        const file = declaredResourceSource(
          this.manifestPath,
          projectPath,
          resource
        )
        if (file) outputs.add(file.output)
      }
    }

    return outputs
  }

  private traceGetURLFiles(run: TraceRun, only?: Set<string>) {
    const manifest = this.readManifest()
    const declaredSurfaces = manifestDeclaredSourcePaths(manifest)
    // A WebKit build emits no page for a key its filter drops, so a literal
    // that still opens one names a file Safari cannot find.
    const droppedPages = new Map(
      isWebkitBasedBrowser(String(this.browser))
        ? webkitDroppedSurfacePages(
            manifest as Record<string, unknown> | undefined
          ).map((page) => [page.path, page] as const)
        : []
    )
    const surfacePages = this.surfacePageOutputs(run.manifestDir)
    const relocatedPages = this.relocatedPageOutputs(run.manifestDir)
    const folderPages = this.folderPageOutputs(run)
    let shippedByWar: Set<string> | undefined
    const seen = run.seen.getURL
    const pageSources = new Map(
      [...surfacePages].map(([sourceRel, output]) => [output, sourceRel])
    )
    const relocatedSurfaceRefs: Array<{
      assetName: string
      literal: string
      distRel: string
    }> = []

    type Ref = {
      literal: string
      baseRel: string
      isStaticImport?: boolean
      isRuntimeSurface?: boolean
      // Set when the browser asks beside the caller: where the file must
      // sit, the places its author may have kept it, and a silent miss.
      distRel?: string | null
      sourceRels?: Array<string | null>
      quiet?: boolean
    }
    let loaders: Map<string, string[]> | undefined

    const surfaceRefs = (
      {literal, reads}: SurfaceReference,
      item: {assetName: string; copied?: boolean}
    ): Ref[] => {
      const atRoot: Ref = {literal, baseRel: '', isRuntimeSurface: true}
      const moved = (bare?: boolean): Ref => ({
        ...atRoot,
        baseRel: item.copied
          ? ''
          : movedPageSourceBase(run, pageSources, item.assetName, literal, bare)
      })
      const address = item.copied
        ? 'unknown'
        : surfaceAddress(reads, String(this.browser))

      if (reads !== 'image' && address === 'root') {
        // A file kept beside the page still ships when the root has none.
        const rootRel = resolveExtensionPath(literal, '')
        const atRootExists =
          rootRel != null &&
          (declaredSurfaces.has(rootRel) ||
            run.hasAsset(rootRel) ||
            isFile(path.join(run.manifestDir, rootRel)) ||
            isFile(path.join(run.manifestDir, 'public', rootRel)))

        return [atRootExists ? atRoot : moved()]
      }

      if (reads === 'page') return [moved(address === 'own')]

      if (address === 'root' || literal.trim().startsWith('/')) return [moved()]

      loaders ??= run.pagesLoadingScripts()
      const callers = run.callerAddresses(
        item.assetName,
        loaders,
        pageSources,
        manifest?.background?.service_worker
      )
      if (reads !== 'image' || !callers) return [moved()]

      const rootRel = resolveExtensionPath(literal, '')
      const beside = callers.map((caller, index) => ({
        ...atRoot,
        distRel: resolveExtensionPath(literal, caller.dist),
        sourceRels: [
          resolveExtensionPath(literal, caller.source),
          rootRel,
          rootRel && `public/${rootRel}`
        ],
        // One absent file is one warning, however many pages ask for it.
        quiet: index > 0
      }))

      return address === 'own' ? beside : [...beside, {...atRoot, quiet: true}]
    }

    // getURL literals resolve against the extension ROOT regardless of context,
    // so, unlike relative fetch(), content scripts are traceable here.
    type PendingScan =
      | {kind: 'js'; content: string; assetName: string; copied?: boolean}
      | {kind: 'html'; content: string; baseRel: string}
      | {kind: 'css'; content: string; baseRel: string; injected?: string}

    const climbingSaid = new Set<string>()
    let pending: PendingScan[] = [
      ...run.jsAssets(only).map((asset) => ({
        kind: 'js' as const,
        content: run.textOf(asset),
        assetName: asset.name
      })),
      // A sheet an injection call ships names fonts and images too. Firefox
      // reads them from where the sheet sits, so they are followed from there.
      ...run.takeInjectedSheets().map((sheet) => ({
        kind: 'css' as const,
        injected: sheet.baseRel,
        ...sheet
      }))
    ]

    // Copied files chain: a getURL'd classic script can call getURL again or
    // import() a module, and a copied HTML page has subresources. Compiled
    // files chain through the next round instead, once their output exists.
    for (let depth = 0; depth < MAX_TRACE_DEPTH && pending.length; depth++) {
      const next: PendingScan[] = []

      for (const item of pending) {
        const refs: Ref[] =
          item.kind === 'js'
            ? [
                ...extractGetURLLiterals(item.content).map((literal) => ({
                  literal,
                  baseRel: ''
                })),
                // Runtime-set surfaces (setPopup, setIcon) are not manifest
                // refs, and each browser reads their path from its own place.
                ...extractRuntimeSurfaceReferences(item.content).flatMap(
                  (ref) => surfaceRefs(ref, item)
                ),
                // Only files WE copied verbatim: emitted bundles had their
                // imports resolved by the bundler already.
                ...(item.copied
                  ? extractStaticImportLiterals(item.content).map(
                      (literal) => ({
                        literal,
                        baseRel: item.assetName,
                        isStaticImport: true
                      })
                    )
                  : [])
              ]
            : (item.kind === 'html'
                ? extractHtmlSubresourceLiterals(item.content)
                : extractCssSubresourceLiterals(item.content)
              ).map((literal) => ({literal, baseRel: item.baseRel}))

        const assetName = item.kind === 'js' ? item.assetName : item.baseRel

        for (const {
          literal,
          baseRel,
          isStaticImport,
          isRuntimeSurface,
          distRel: besideCaller,
          sourceRels,
          quiet
        } of refs) {
          const distRel =
            besideCaller === undefined
              ? resolveExtensionPath(literal, baseRel)
              : besideCaller
          if (!distRel) continue

          // A target climbing out of the extension root stays as written and
          // is said once, whether or not a file sits there, confirming none.
          if (
            item.kind === 'css' &&
            item.injected &&
            climbsOutOfSheetRoot(literal, baseRel)
          ) {
            const said = `${baseRel}\n${literal}`

            if (!climbingSaid.has(said)) {
              climbingSaid.add(said)
              run.sayNotShipped(assetName, literal, distRel)()
            }

            continue
          }

          // The visited page fetches what an injected sheet names, so the
          // manifest step hears of each file. An @import is not fetched.
          if (
            item.kind === 'css' &&
            item.injected &&
            !/\.css$/i.test(distRel)
          ) {
            noteInjectedSheetTarget(run.compilation, item.injected, distRel)
          }

          const sourceRel =
            sourceRels?.find(
              (rel) => rel && isFile(path.join(run.manifestDir, rel))
            ) ||
            sourceRels?.[0] ||
            distRel

          if (isRuntimeSurface && baseRel && item.kind === 'js') {
            relocatedSurfaceRefs.push({
              assetName: item.assetName,
              literal,
              distRel
            })
          }

          if (seen.has(distRel)) continue

          seen.add(distRel)

          const droppedOwner = droppedPages.get(distRel)

          if (droppedOwner) {
            if (item.kind === 'js') {
              run.warn(
                'WebkitDroppedPageOpened',
                assetName,
                messages.webkitDroppedPageOpened(
                  assetName,
                  literal,
                  droppedOwner,
                  String(this.browser)
                )
              )
            }

            continue
          }

          // Manifest-declared page and background surfaces are compiled and
          // relocated by the main pipeline, copying their raw sources would
          // ship duplicates. A page is also served where the literal asks for
          // it: its compiled markup names its script and sheet from the root.
          if (declaredSurfaces.has(distRel)) {
            const output = surfacePages.get(distRel)

            servePageAtAuthoredPath(
              run,
              distRel,
              relocatedPages.get(distRel) ?? (output ? [output] : [])
            )

            continue
          }

          // A pages/ folder page is compiled too. Its source copied as
          // written would ship a second page that loads uncompiled scripts.
          const folderPage = folderPages.get(distRel)

          if (folderPage && run.hasAsset(folderPage)) {
            servePageAtAuthoredPath(run, distRel, [folderPage])

            continue
          }

          // getURL paths are root-anchored, so source and dist paths match.
          const plan = run.plan({sourceRel, distRel, loadsAs: 'by-shape'})
          // Warn only for extensioned getURL misses found in JS: HTML
          // misses are the page author's problem, extensionless args
          // often origin math.
          const missSpeaks =
            item.kind === 'js' && /\.[a-zA-Z0-9]{1,8}$/.test(distRel)

          const sayMissing = () => {
            const {expectedPath, foundOutside} = this.missingFileHint(
              run,
              sourceRel
            )

            run.warn(
              isStaticImport
                ? 'RuntimeStaticImportFileMissing'
                : isRuntimeSurface
                  ? 'RuntimeSetSurfaceFileMissing'
                  : 'RuntimeGetURLFileMissing',
              assetName,
              isStaticImport
                ? messages.staticImportDependencyMissing(
                    assetName,
                    literal,
                    expectedPath,
                    foundOutside
                  )
                : isRuntimeSurface
                  ? messages.runtimeSetSurfaceDependencyMissing(
                      assetName,
                      literal,
                      expectedPath,
                      foundOutside
                    )
                  : messages.getURLDependencyMissing(
                      assetName,
                      literal,
                      expectedPath,
                      foundOutside
                    )
            )
          }

          const copied = run.apply(plan, {
            context: item.kind === 'js' ? 'getURL' : 'html',
            onMissing: () => {
              if (quiet) return

              shippedByWar ??= this.webAccessibleOutputs(run)
              if (shippedByWar.has(distRel)) return

              if (missSpeaks) sayMissing()
            },
            // A withheld file is said where a miss stays quiet, since the
            // file is there and the author cannot tell why it did not ship.
            onWithheld: () => {
              if (quiet) return

              if (missSpeaks) sayMissing()
              else run.sayNotShipped(assetName, literal, distRel)()
            },
            onSourceSpelling: (emitPath) =>
              run.warn(
                'RuntimeGetURLCompiledSource',
                assetName,
                messages.compiledSourceSpelling(
                  assetName,
                  item.kind === 'html'
                    ? 'an HTML src/href attribute'
                    : 'chrome.runtime.getURL()',
                  literal,
                  emitPath
                )
              )
          })

          if (copied == null) continue

          if (/\.(?:js|mjs)$/i.test(distRel)) {
            next.push({
              kind: 'js',
              content: copied,
              assetName: distRel,
              copied: true
            })
          } else if (/\.html?$/i.test(distRel)) {
            next.push({kind: 'html', content: copied, baseRel: distRel})
          } else if (/\.css$/i.test(distRel)) {
            // A sheet copied as written still asks for its fonts and images,
            // and one an injected sheet imports lands on the same page.
            next.push({
              kind: 'css',
              content: copied,
              baseRel: distRel,
              injected: item.kind === 'css' ? item.injected : undefined
            })
          }
        }
      }

      pending = next
    }

    for (const ref of relocatedSurfaceRefs) {
      const target = declaredSurfaces.has(ref.distRel)
        ? surfacePages.get(ref.distRel) || ref.distRel
        : ref.distRel

      if (!run.hasAsset(target)) continue

      // The page moved, the query and fragment it was opened with did not.
      rewriteStringLiteral(
        run.compilation,
        ref.assetName,
        ref.literal,
        `/${target}${ref.literal.match(/[?#].*$/)?.[0] ?? ''}`
      )

      run.forgetText(ref.assetName)
    }
  }

  // A path kept as a plain string and handed on to fetch or setIcon proves
  // no call, yet it names a file the extension reads, so the file ships.
  private traceNamedFiles(run: TraceRun, only?: Set<string>) {
    const {manifestDir} = run
    const seen = run.seen.named
    const pages = run.pagesLoadingScripts()

    for (const asset of run.jsAssets(only)) {
      // A script in a web page resolves a relative path against the site,
      // so only the root of the extension is a place it can mean.
      const inWebPage =
        asset.name.startsWith('content_scripts/') ||
        asset.name.startsWith('scripts/')
      const loaders = pages.get(asset.name)
      const bases = inWebPage ? [] : (loaders ?? [ownAddressOf(asset.name)])
      const literals = extractPathLiterals(blankComments(run.textOf(asset)))
      const forms = provenReferenceForms(
        run.textOf(asset),
        literals,
        extractRuntimeSurfaceReferences(run.textOf(asset)).map((ref) => ({
          literal: ref.literal,
          form: surfaceAddress(ref.reads, String(this.browser))
        }))
      )
      // Where a script reads from is known for the background and for a
      // script its pages name, unless a base element moves what a path means.
      const ownAddressKnown = loaders
        ? !loaders.some((page) => run.hasBaseElement(page))
        : asset.name === EMITTED_WORKER_PATH ||
          asset.name === EMITTED_BACKGROUND_SCRIPTS_PATH

      for (const literal of literals) {
        const file = toRuntimePathReference(literal)?.file
        if (!file?.includes('/')) continue

        const form = inWebPage ? undefined : forms.get(literal)
        const targets =
          form === 'own' && ownAddressKnown
            ? []
            : [{distRel: file, sources: [path.join(manifestDir, file)]}]

        for (const base of form === 'root' ? [] : bases) {
          const distRel = resolveExtensionPath(literal, base)
          if (!distRel) continue

          // A page the build moved asks from its new folder for a file the
          // author placed next to the old one.
          const entryDir = run.entrySourceDirs.get(
            base.replace(/\.(?:js|html)$/i, '')
          )

          targets.push({
            distRel,
            sources: [
              path.join(manifestDir, distRel),
              ...(entryDir && !literal.startsWith('/')
                ? [path.resolve(entryDir, literal)]
                : [])
            ]
          })
        }

        for (const {distRel, sources: candidates} of targets) {
          if (seen.has(distRel)) continue
          if (run.hasAsset(distRel)) continue
          if (isFile(path.join(manifestDir, 'public', distRel))) continue

          const abs = candidates.find(
            (candidate) =>
              !path.relative(manifestDir, candidate).startsWith('..') &&
              isFile(candidate) &&
              !run.isNamedModule(candidate)
          )
          if (!abs) continue

          seen.add(distRel)
          run.emitCopy(
            abs,
            distRel,
            run.sayNotShipped(asset.name, literal, distRel)
          )
        }
      }
    }
  }

  // Prebuilt webpack bundles are finished output, so their numeric chunks are
  // copied as-is.
  private traceWebpackChunkSiblings(run: TraceRun, only?: Set<string>) {
    const {manifestDir, entrySourceDirs} = run

    for (const asset of run.jsAssets(only)) {
      const content = run.textOf(asset)
      if (!hasWebpackChunkLoadingRuntime(content)) continue

      // Prebuilt webpack bundles address lazy chunks by NUMERIC id via
      // publicPath concat, so literal tracing is blind; copy numeric siblings.
      const assetDirRel = path.posix.dirname(unixify(asset.name))
      const sourceDirs = new Set<string>()
      const entryDir = entrySourceDirs.get(asset.name.replace(/\.js$/i, ''))
      if (entryDir) sourceDirs.add(entryDir)

      // Copied-verbatim assets keep their source-relative path in dist.
      sourceDirs.add(path.dirname(path.join(manifestDir, asset.name)))

      for (const sourceDir of sourceDirs) {
        if (path.relative(manifestDir, sourceDir).startsWith('..')) continue

        let siblings: string[]

        try {
          siblings = fs.readdirSync(sourceDir)
        } catch {
          continue
        }

        for (const file of siblings) {
          if (!/^\d+\.(?:js|css)(?:\.map)?$/.test(file)) continue

          const abs = path.join(sourceDir, file)
          // publicPath is "" (page-relative) in some prebuilt bundles and
          // "/" (root-anchored) in others, emit at both resolutions.
          run.copySibling(abs, file)

          if (assetDirRel && assetDirRel !== '.') {
            run.copySibling(abs, `${assetDirRel}/${file}`)
          }
        }
      }
    }
  }

  private traceInjectedFilePayloads(run: TraceRun, only?: Set<string>) {
    const seen = run.seen.injected

    for (const asset of run.jsAssets(only)) {
      const content = run.textOf(asset)

      for (const literal of extractInjectedFileLiterals(content)) {
        const distRel = resolveExtensionPath(literal, '')
        if (!distRel || seen.has(distRel)) continue

        seen.add(distRel)

        const plan = run.plan({
          sourceRel: distRel,
          distRel,
          loadsAs: 'classic'
        })
        const copied = run.apply(plan, {
          context: 'injected',
          onMissing: () =>
            run.warn(
              'InjectedScriptFilesMissing',
              asset.name,
              messages.injectedFileDependencyMissing(
                asset.name,
                literal,
                distRel
              )
            ),
          // The literal spells the source of a file this build compiles, so
          // the browser would request a path that is not in the output.
          onSourceSpelling: (emitPath) =>
            run.warn(
              'InjectedScriptCompiledSource',
              asset.name,
              messages.injectedCompiledSourceLiteral(
                asset.name,
                literal,
                emitPath
              )
            )
        })

        run.noteInjectedSheet(distRel, copied, plan)
      }
    }

    // A bundle keeps an imported constant as a member of its module, so
    // those paths are read from the sources, once per build.
    if (only) return

    for (const {literal, sourceName} of run.constantInjectedFiles()) {
      const distRel = resolveExtensionPath(literal, '')
      if (!distRel || seen.has(distRel)) continue

      seen.add(distRel)

      const plan = run.plan({sourceRel: distRel, distRel, loadsAs: 'classic'})
      // Held to what a literal is, the warning naming the source file.
      const copied = run.apply(plan, {
        context: 'injected',
        onMissing: () =>
          run.warn(
            'InjectedScriptFilesMissing',
            sourceName,
            messages.injectedFileDependencyMissing(sourceName, literal, distRel)
          ),
        onSourceSpelling: (emitPath) =>
          run.warn(
            'InjectedScriptCompiledSource',
            sourceName,
            messages.injectedCompiledSourceLiteral(
              sourceName,
              literal,
              emitPath
            )
          )
      })

      run.noteInjectedSheet(distRel, copied, plan)
    }
  }
}

// One tracing pass over a compilation: the dedupe sets every step shares, the
// files queued for the bundler, and the emit helpers.
// The bundler keeps only the fields it knows on a warning, so what a run
// said it left out is kept here for the step that reads the same file next.
const SAID_NOT_SHIPPED = new WeakMap<object, Set<string>>()

function noteSaidNotShipped(
  compilation: object,
  assetName: string,
  distRel: string
) {
  const said = SAID_NOT_SHIPPED.get(compilation) || new Set<string>()

  said.add(`${assetName}\n${distRel}`)
  SAID_NOT_SHIPPED.set(compilation, said)
}

export function saidNotShipped(
  compilation: object,
  assetName: string,
  distRel: string
): boolean {
  return Boolean(
    SAID_NOT_SHIPPED.get(compilation)?.has(`${assetName}\n${distRel}`)
  )
}

class TraceRun {
  readonly seen = {
    importScripts: new Set<string>(),
    injected: new Set<string>(),
    fetched: new Set<string>(),
    getURL: new Set<string>(),
    named: new Set<string>()
  }
  // Assets that execute in the worker's scope, so importScripts literals in
  // them resolve against the worker URL.
  readonly workerScope = new Set<string>([EMITTED_WORKER_PATH])
  readonly entrySourceDirs: Map<string, string>
  readonly hasAsset: (name: string) => boolean
  // The compiled page each authored page path serves a copy of.
  readonly servedPages = new Map<string, string>()
  private readonly queue = new Map<string, CompileRequest>()
  private readonly texts = new Map<string, string>()
  // Files the `exclude` config leaves out of this build. A literal that names
  // one is dead code on this browser, so the trace ships nothing for it.
  private readonly excluded: ReadonlySet<string>
  private namedModules?: Set<string>
  private injectedSheets: Array<{content: string; baseRel: string}> = []
  private chunkEntries?: Map<string, Set<string>>
  private readonly builtSheets = new Set<string>()
  private readonly licensedDirs = new Set<string>()
  // The output paths of files the code names and the build may not copy.
  readonly withheld = new Set<string>()
  private readonly projectRoots: string[]

  constructor(
    readonly compilation: Compilation,
    readonly compiler: Compiler,
    readonly manifestDir: string
  ) {
    this.entrySourceDirs = collectEntrySourceDirs(compiler)
    this.hasAsset = (name) => Boolean(compilation.getAsset(name))
    this.excluded = excludedFiles(
      (compiler.options.context as string | undefined) || manifestDir
    )

    this.projectRoots = [
      (compiler.options.context as string | undefined) || manifestDir,
      manifestDir
    ]
  }

  // The one guard every traced file passes before it is read: a private
  // name, a place outside the project or a link to either never ships.
  private readonly mayShip = (abs: string) =>
    sourceFileMayShip(abs, this.projectRoots)

  // Nothing is emitted for the path, and the build says so once.
  private withhold(distRel: string, say: () => void) {
    if (this.withheld.has(distRel)) return

    this.withheld.add(distRel)
    say()
  }

  // For a trace that stays quiet about a miss: the file is there, so the
  // author is told why the output lacks it.
  sayNotShipped(assetName: string, literal: string, distRel: string) {
    return () => {
      noteSaidNotShipped(this.compilation, assetName, distRel)
      this.warn(
        'CodeNamedFileNotShipped',
        assetName,
        messages.codeNamedFileNotShipped(assetName, literal, distRel)
      )
    }
  }

  plan(opts: {
    sourceRel: string
    distRel: string
    loadsAs: TracedLoad
  }): TracedFilePlan {
    return planTracedFile({
      ...opts,
      manifestDir: this.manifestDir,
      hasAsset: this.hasAsset,
      mayRead: this.mayShip
    })
  }

  // A file that rides along with a traced one, which no code names.
  copySibling(abs: string, distRel: string) {
    if (this.hasAsset(distRel) || !isFile(abs) || !this.mayShip(abs)) return

    this.compilation.emitAsset(
      distRel,
      new sources.RawSource(fs.readFileSync(abs))
    )

    this.watch(abs)
  }

  // The paths injection calls name through a constant, read from every
  // local source this compilation was built from.
  constantInjectedFiles(): Array<{literal: string; sourceName: string}> {
    const found: Array<{literal: string; sourceName: string}> = []
    const projectPath =
      (this.compiler.options?.context as string | undefined) || this.manifestDir
    let resolver: LocalImportResolver | undefined

    const resolveImport = () => {
      resolver ??= createLocalImportResolver(projectPath)

      return resolver
    }

    try {
      for (const file of this.compilation.fileDependencies ?? []) {
        if (typeof file !== 'string' || !isLocalScriptSource(file)) continue

        const sourceName = unixify(path.relative(projectPath, file))

        for (const literal of constantInjectedFiles(file, resolveImport)) {
          found.push({literal, sourceName})
        }
      }
    } catch {
      // Ignore, a source that cannot be read names nothing
    }

    return found
  }

  // The project file and line that spell a string, so a build line names
  // code the author can open and not a chunk the bundler named.
  sourceNaming(literal: string): string | undefined {
    const projectPath =
      (this.compiler.options?.context as string | undefined) || this.manifestDir

    try {
      for (const file of this.compilation.fileDependencies ?? []) {
        if (typeof file !== 'string' || !isLocalScriptSource(file)) continue

        const text = readScriptText(file)
        const at = text === undefined ? -1 : text.indexOf(literal)
        if (text === undefined || at === -1) continue

        const line = text.slice(0, at).split('\n').length

        return `${unixify(path.relative(projectPath, file))}:${line}`
      }
    } catch {
      // Ignore, a source that cannot be read names nothing
    }

    return undefined
  }

  // A stylesheet an injection call copied as written, kept for the scan
  // that follows the files a copied sheet names.
  noteInjectedSheet(
    distRel: string,
    copied: string | null,
    plan: TracedFilePlan
  ) {
    if (!/\.css$/i.test(distRel) || this.withheld.has(distRel)) return

    // A public/ file ships byte for byte, and the copier has it in the
    // output before this trace runs, so the folder says whose file it is.
    if (isFile(path.join(this.manifestDir, 'public', distRel))) {
      notePublicInjectedSheet(this.compilation, distRel)
    } else if (plan.kind !== 'missing') {
      noteNamedInjectedSheet(this.compilation, plan.emitPath)

      // A sheet the bundler writes is read once it exists.
      if (plan.kind !== 'copy') this.builtSheets.add(plan.emitPath)
    }

    if (copied == null) return

    this.injectedSheets.push({content: copied, baseRel: distRel})
  }

  takeInjectedSheets(): Array<{content: string; baseRel: string}> {
    const sheets = this.injectedSheets
    this.injectedSheets = []

    return sheets
  }

  // The pages each emitted script is loaded by, since a relative path in a
  // script resolves against the page and not against the script.
  pagesLoadingScripts(): Map<string, string[]> {
    const pages = new Map<string, string[]>()

    for (const asset of this.compilation.getAssets()) {
      if (!/\.html?$/i.test(asset.name)) continue

      const page = unixify(asset.name)
      const markup = asset.source.source().toString()

      for (const match of markup.matchAll(SCRIPT_SRC)) {
        const script = resolveExtensionPath(match[2], page)
        if (!script) continue

        const loaders = pages.get(script) ?? []

        if (!loaders.includes(page)) loaders.push(page)

        pages.set(script, loaders)
      }
    }

    return pages
  }

  // Where a script runs in the output and where its author wrote it: the
  // worker, the root page of background scripts, or the pages that name it.
  callerAddresses(
    assetName: string,
    loaders: Map<string, string[]>,
    pageSources: Map<string, string>,
    workerRef: unknown
  ): Array<{dist: string; source: string}> | undefined {
    if (assetName === EMITTED_BACKGROUND_SCRIPTS_PATH) {
      return [{dist: '', source: ''}]
    }

    if (assetName === EMITTED_WORKER_PATH) {
      return typeof workerRef === 'string'
        ? [{dist: assetName, source: unixify(workerRef).replace(/^\/+/, '')}]
        : undefined
    }

    const pages = loaders.get(assetName)

    if (!pages) {
      // A chunk import() made runs in the worker or page of each entry
      // that loads it, and the browser asks beside that, not the chunk.
      const callers = this.entriesLoading(assetName).map((entry) =>
        this.callerAddresses(entry, loaders, pageSources, workerRef)
      )

      if (!callers.length || callers.some((found) => !found)) return undefined

      return [
        ...new Map(
          callers.flatMap((found) =>
            (found ?? []).map((caller) => [caller.dist, caller] as const)
          )
        ).values()
      ]
    }

    if (pages.some((page) => this.hasBaseElement(page))) return undefined

    return pages.map((page) => {
      const entryDir = this.entrySourceDirs.get(page.replace(/\.html?$/i, ''))
      const written =
        pageSources.get(page) ??
        (entryDir
          ? unixify(
              path.join(path.relative(this.manifestDir, entryDir), 'index.html')
            )
          : page)

      return {dist: page, source: written.startsWith('..') ? page : written}
    })
  }

  // The entry scripts that reach each on-demand chunk, by emitted name.
  private entriesLoading(assetName: string): string[] {
    if (!this.chunkEntries) {
      const entries = new Map<string, Set<string>>()
      this.chunkEntries = entries

      type Group = {
        chunks?: Iterable<{files?: Iterable<string>}>
        childrenIterable?: Iterable<Group>
        getChildren?: () => Iterable<Group>
        getFiles?: () => Iterable<string>
      }
      const childrenOf = (group: Group) =>
        group.childrenIterable ?? group.getChildren?.() ?? []

      this.compilation.entrypoints?.forEach?.((entry: Group) => {
        const scripts = [...(entry.getFiles?.() ?? [])].filter((file) =>
          /\.js$/i.test(file)
        )
        const seen = new Set<Group>()

        const visit = (group: Group) => {
          if (seen.has(group)) return

          seen.add(group)

          for (const chunk of group.chunks ?? []) {
            for (const file of chunk.files ?? []) {
              if (scripts.includes(file)) continue

              const loading = entries.get(file) ?? new Set<string>()

              for (const script of scripts) loading.add(script)

              entries.set(file, loading)
            }
          }

          for (const child of childrenOf(group)) visit(child)
        }

        for (const child of childrenOf(entry)) visit(child)
      })
    }

    return [...(this.chunkEntries.get(assetName) ?? [])]
  }

  hasBaseElement(page: string): boolean {
    const asset = this.compilation.getAsset(page)

    return asset ? /<base\b/i.test(this.textOf(asset)) : false
  }

  // A development bundle names each module by its path, so there a string
  // that names an imported file is the bundler's own and ships nothing.
  isNamedModule(abs: string): boolean {
    if (this.compiler.options?.mode !== 'development') return false

    if (!this.namedModules) {
      this.namedModules = new Set()

      for (const module of this.compilation.modules ?? []) {
        const resource = (module as {resource?: string}).resource
        if (resource) this.namedModules.add(resource.split('?')[0])
      }
    }

    return this.namedModules.has(abs)
  }

  // Every trace reads the same emitted scripts, and each read of an asset
  // copies its text out of the bundler, so a run holds one copy per asset.
  textOf(asset: {name: string; source: {source(): string | Buffer}}): string {
    let text = this.texts.get(asset.name)

    if (text === undefined) {
      text = asset.source.source().toString()
      this.texts.set(asset.name, text)
    }

    return text
  }

  // An asset this run rewrote is read again the next time it is scanned.
  forgetText(assetName: string) {
    this.texts.delete(assetName)
  }

  jsAssets(only?: Set<string>) {
    return this.compilation
      .getAssets()
      .filter(
        (asset) => /\.js$/i.test(asset.name) && (!only || only.has(asset.name))
      )
  }

  // Copies return their text so the caller can keep scanning it. Compiles are
  // queued and return null: their output is scanned in the next round.
  apply(plan: TracedFilePlan, ctx: ApplyContext): string | null {
    if (
      (plan.kind === 'copy' || plan.kind === 'compile') &&
      isExcludedEntry(plan.sourcePath, this.excluded)
    ) {
      return null
    }

    if (
      (plan.kind === 'copy' || plan.kind === 'compile') &&
      !this.mayShip(plan.sourcePath)
    ) {
      this.withhold(plan.emitPath, ctx.onWithheld ?? ctx.onMissing)

      return null
    }

    switch (plan.kind) {
      case 'skip':
        if (plan.reason === 'compiled-elsewhere') {
          ctx.onSourceSpelling(plan.emitPath, plan.spelledAs)
        }

        return null
      case 'missing':
        ctx.onMissing()

        return null
      case 'copy':
        return this.emitCopy(plan.sourcePath, plan.emitPath, () => {})

      case 'compile': {
        if (plan.spelledAs) ctx.onSourceSpelling(plan.emitPath, plan.spelledAs)

        // First request for an output path wins, so a file reached through
        // two literals (its source and its emitted spelling) compiles once.
        if (!this.queue.has(plan.emitPath)) {
          this.queue.set(plan.emitPath, {
            sourcePath: plan.sourcePath,
            emitPath: plan.emitPath,
            format: plan.format,
            context: ctx.context
          })
        }

        if (ctx.context === 'importScripts') this.workerScope.add(plan.emitPath)

        this.watch(plan.sourcePath)

        return null
      }
    }
  }

  emitCopy(abs: string, distRel: string, onWithheld: () => void): string {
    if (isExcludedEntry(abs, this.excluded)) return ''

    if (!this.mayShip(abs)) {
      this.withhold(distRel, onWithheld)

      return ''
    }

    const buffer = fs.readFileSync(abs)
    this.compilation.emitAsset(distRel, new sources.RawSource(buffer))
    this.watch(abs)

    if (FONT_FILE.test(distRel)) this.emitLicensesBeside(abs, distRel)

    return buffer.toString()
  }

  // A font's license ties redistribution to its notice, and no code names
  // that file, so it ships with a font copied from the folder that holds it.
  private emitLicensesBeside(fontAbs: string, fontDistRel: string) {
    const sourceDir = path.dirname(fontAbs)
    const distDir = path.posix.dirname(unixify(fontDistRel))

    // The notice at the root of the project is the extension's own.
    if (distDir === '.' || path.relative(this.manifestDir, sourceDir) === '') {
      return
    }

    const key = `${sourceDir}\n${distDir}`
    if (this.licensedDirs.has(key)) return

    this.licensedDirs.add(key)

    let entries: fs.Dirent[]

    try {
      entries = fs.readdirSync(sourceDir, {withFileTypes: true})
    } catch {
      return
    }

    for (const entry of entries) {
      if (!entry.isFile() || !LICENSE_FILE.test(entry.name)) continue

      const abs = path.join(sourceDir, entry.name)
      const distRel = `${distDir}/${entry.name}`

      if (
        this.hasAsset(distRel) ||
        isExcludedEntry(abs, this.excluded) ||
        !this.mayShip(abs)
      ) {
        continue
      }

      this.compilation.emitAsset(
        distRel,
        new sources.RawSource(fs.readFileSync(abs))
      )

      this.watch(abs)
    }
  }

  warn(name: string, file: string, message: string) {
    const warning = new WebpackError(message) as Error & {
      file?: string
      name?: string
    }
    warning.name = name
    warning.file = file
    this.compilation.warnings ||= []
    this.compilation.warnings.push(warning)
  }

  watch(abs: string) {
    try {
      this.compilation.fileDependencies.add(abs)
    } catch {
      // Ignore, watch registration is best-effort
    }
  }

  // Runs the queued sources through the bundler and returns the JS assets
  // that appeared, so the caller can scan them for further runtime loads.
  async flushCompiles(): Promise<string[]> {
    const requests = [...this.queue.values()]
    this.queue.clear()
    const emitted = await compileRuntimeLoadedFiles(
      this.compilation,
      this.compiler,
      requests
    )

    // The visited page fetches the assets a compiled injected sheet names,
    // as it does for a copied one, so the manifest step hears of them too.
    for (const sheet of this.builtSheets) {
      const asset = this.compilation.getAsset(sheet)
      if (!asset) continue

      for (const literal of extractCssSubresourceLiterals(
        asset.source.source().toString()
      )) {
        const target = resolveExtensionPath(literal, sheet)

        if (target && !/\.css$/i.test(target) && this.hasAsset(target)) {
          noteInjectedSheetTarget(this.compilation, sheet, target)
        }
      }
    }

    this.builtSheets.clear()

    return emitted.filter((name) => /\.js$/i.test(name))
  }
}

// Runs planned sources through the bundler, one child per output format, and
// returns the names of the assets that appeared. The special-folders plugin
// reaches the same kind of file through root-absolute HTML and CSS refs and
// compiles them here too, so both sites ship identical output.
export async function compileRuntimeLoadedFiles(
  compilation: Compilation,
  compiler: Compiler,
  requests: CompileRequest[]
): Promise<string[]> {
  if (requests.length === 0) return []

  const before = new Set(compilation.getAssets().map((asset) => asset.name))

  for (const request of requests) {
    await compileTracedFile({compilation, compiler}, request)
  }

  return compilation
    .getAssets()
    .map((asset) => asset.name)
    .filter((name) => !before.has(name))
}

// Decide how a traced file ships. The browser runs a classic .js file as
// written, and copying keeps the globals side-by-side classic scripts share.
// Everything the browser cannot run as written (TypeScript, JSX, ES modules
// with imports to resolve) goes through the bundler, emitted at the path the
// runtime asks for, or at the .js spelling when the literal names a source.
export function planTracedFile(opts: {
  manifestDir: string
  sourceRel: string
  distRel: string
  loadsAs: TracedLoad
  hasAsset: (name: string) => boolean
  // Asked before a source is opened to tell its shape. A file it refuses
  // is planned as a copy, unread, for the caller's guard to withhold.
  mayRead?: (abs: string) => boolean
}): TracedFilePlan {
  const {manifestDir, sourceRel, distRel, loadsAs, hasAsset} = opts
  const unread = (abs: string) => Boolean(opts.mayRead && !opts.mayRead(abs))

  // Already produced by the compilation (an emitted chunk or a previously
  // traced file), nothing to do.
  if (hasAsset(distRel)) {
    return {kind: 'skip', reason: 'emitted', emitPath: distRel}
  }

  // public/ files land at the output root via the special-folders pipeline.
  if (isFile(path.join(manifestDir, 'public', distRel))) {
    return {kind: 'skip', reason: 'public', emitPath: distRel}
  }

  const abs = path.join(manifestDir, sourceRel)
  const inside = !path.relative(manifestDir, abs).startsWith('..')
  const ext = path.posix.extname(distRel).toLowerCase()

  if (inside && isFile(abs)) {
    if (!SCRIPT_EXTENSIONS.has(ext) || unread(abs)) {
      return {kind: 'copy', sourcePath: abs, emitPath: distRel}
    }

    const emitted = compiledSourceEmittedPath(distRel)

    if (emitted) {
      // The main pipeline already compiled this source (a scripts/ entry):
      // its output owns the .js path, the source spelling ships nothing.
      if (hasAsset(emitted)) {
        return {
          kind: 'skip',
          reason: 'compiled-elsewhere',
          emitPath: emitted,
          spelledAs: distRel
        }
      }

      const format = formatFor(abs, loadsAs)

      if (SOURCE_ONLY_EXTENSIONS.has(ext)) {
        return {
          kind: 'compile',
          sourcePath: abs,
          emitPath: emitted,
          format,
          spelledAs: distRel
        }
      }

      return {kind: 'compile', sourcePath: abs, emitPath: distRel, format}
    }

    if (isClassicScript(abs)) {
      return {kind: 'copy', sourcePath: abs, emitPath: distRel}
    }

    return {
      kind: 'compile',
      sourcePath: abs,
      emitPath: distRel,
      format: formatFor(abs, loadsAs)
    }
  }

  // The literal names the emitted .js of a source the build compiles, the
  // same mapping the manifest pipeline applies to scripts/ files.
  if (inside && ext === '.js') {
    const sibling = findSourceSibling(abs)

    if (sibling && unread(sibling)) {
      return {kind: 'copy', sourcePath: sibling, emitPath: distRel}
    }

    if (sibling) {
      return {
        kind: 'compile',
        sourcePath: sibling,
        emitPath: distRel,
        format: formatFor(sibling, loadsAs)
      }
    }
  }

  // The literal names the emitted .css of a Sass or Less source, the way a
  // .js literal names the output of a TypeScript one.
  if (inside && ext === '.css') {
    const sibling = findStylesheetSibling(abs)

    if (sibling) {
      return {
        kind: 'compile',
        sourcePath: sibling,
        emitPath: distRel,
        format: 'classic'
      }
    }
  }

  return {kind: 'missing', emitPath: distRel}
}

function formatFor(sourcePath: string, loadsAs: TracedLoad): TracedFormat {
  if (loadsAs === 'classic') return 'classic'

  return isClassicScript(sourcePath) ? 'classic' : 'module'
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

// Compile a traced source in a child of the main compilation, one per file,
// so it gets the same loaders and resolution as every entry. The child's
// asset lands in the parent at the path the runtime asks for.
async function compileTracedFile(
  host: CompileHost,
  request: CompileRequest
): Promise<void> {
  const {compilation, compiler} = host
  const isModule = request.format === 'module'
  // executeScript resolves with the value a classic file ends on.
  const keepsValue =
    !isModule &&
    request.context === 'injected' &&
    /\.js$/i.test(request.emitPath)
  if (keepsValue) keepCompletionValueOf(compilation, request.emitPath)

  const chunkLoading = isModule
    ? 'import'
    : request.context === 'importScripts'
      ? 'import-scripts'
      : 'jsonp'

  // A stylesheet entry emits its CSS under the entry name and a script with
  // nothing in it, which is parked on a name of its own and dropped below.
  const stylesheetScript = /\.css$/i.test(request.emitPath)
    ? `${request.emitPath}.js`
    : undefined

  const entry = new EntryPlugin(
    compiler.context,
    isModule
      ? request.sourcePath
      : `${request.sourcePath}${CLASSIC_GLOBALS_QUERY}${keepsValue ? `&${INJECTED_CLASSIC_QUERY}` : ''}`,
    {
      name: request.emitPath.replace(/\.[^./]+$/, ''),
      filename: stylesheetScript || request.emitPath,
      chunkLoading,
      ...(isModule ? {library: {type: 'module'}} : {})
    }
  )

  // The file is fetched at its emit path, so import.meta.url is that URL,
  // not the page-or-root guess the inherited define gives main entries.
  const importMetaUrl = new DefinePlugin({
    'import.meta.url': importMetaUrlForEmitPath(request.emitPath)
  })

  const child = compilation.createChildCompiler(
    `${TraceRuntimeLoadedFiles.name}:${request.format}`,
    {
      filename: '[name].js',
      module: isModule,
      // No wrapper: a lone classic file keeps its top-level declarations
      // global, which is what importScripts and injected scripts rely on.
      iife: false,
      chunkFormat: isModule ? 'module' : 'array-push',
      chunkLoading: isModule ? 'import' : 'jsonp',
      library: isModule ? {type: 'module'} : undefined,
      clean: false
    } as unknown as Parameters<Compilation['createChildCompiler']>[1],
    [entry, importMetaUrl]
  )

  // Applied after the inherited builtins: the module library marks the
  // entry's exports as used when it runs, which must come after provided
  // exports are known or production tree-shakes every export away.
  new rspackJavascript.EnableChunkLoadingPlugin(chunkLoading).apply(child)

  if (isModule) new rspackLibrary.EnableLibraryPlugin('module').apply(child)

  child.options.entry = {}
  child.options.optimization = {
    ...child.options.optimization,
    splitChunks: false,
    runtimeChunk: false
  }

  child.options.module = {
    ...child.options.module,
    // A runtime-loaded file is fetched by URL as one script, so it ships
    // self-contained: relative import() calls are inlined, getURL ones are
    // kept native by the loader upstream.
    parser: withEagerDynamicImports(
      child.options.module.parser as Record<string, unknown> | undefined
    ) as typeof child.options.module.parser,
    // Fast-refresh code needs the dev runtime the parent entries carry.
    rules: [
      ...(isModule ? [] : [classicGlobalsRule()]),
      ...withoutDevRefresh(child.options.module.rules as LooseRule[])
    ] as typeof child.options.module.rules
  }

  await new Promise<void>((resolve) => {
    child.runAsChild((error, _entries, childCompilation) => {
      if (error) {
        const failure = new WebpackError(
          `Compiling runtime-loaded ${request.emitPath} failed: ${error.message}`
        ) as Error & {name?: string}
        failure.name = 'RuntimeLoadedFileCompileFailed'
        compilation.errors.push(failure)
      }

      if (childCompilation) {
        // Stats only count the parent's own diagnostics, so a broken traced
        // source has to fail the build from here.
        for (const childError of childCompilation.errors) {
          compilation.errors.push(childError)
        }

        for (const childWarning of childCompilation.warnings) {
          compilation.warnings ||= []
          compilation.warnings.push(childWarning)
        }

        try {
          for (const dep of childCompilation.fileDependencies) {
            compilation.fileDependencies.add(dep)
          }

          for (const dep of childCompilation.contextDependencies) {
            compilation.contextDependencies.add(dep)
          }
        } catch {
          // Ignore, watch registration is best-effort
        }
      }

      if (stylesheetScript && compilation.getAsset(stylesheetScript)) {
        compilation.deleteAsset(stylesheetScript)
      }

      resolve()
    })
  })
}

export function withEagerDynamicImports(
  parser: Record<string, unknown> | undefined
): Record<string, unknown> {
  const next: Record<string, unknown> = {...(parser || {})}

  for (const key of [
    'javascript',
    'javascript/auto',
    'javascript/esm',
    'javascript/dynamic'
  ]) {
    next[key] = {
      ...((next[key] as Record<string, unknown> | undefined) || {}),
      dynamicImportMode: 'eager'
    }
  }

  return next
}

// Marks only the classic entry itself, so the modules it imports stay private.
const CLASSIC_GLOBALS_QUERY = '?__extensionjs_traced_classic__'

function classicGlobalsRule(): LooseRule {
  return {
    resourceQuery: /[?&]__extensionjs_traced_classic__/,
    enforce: 'post',
    use: {
      loader: resolveDevelopDistFile(
        'feature-scripts-classic-traced-globals-loader'
      )
    }
  }
}

type LooseUse =
  | string
  | {loader?: string; options?: Record<string, unknown>}
  | ((...args: unknown[]) => unknown)
interface LooseRule {
  loader?: string
  use?: LooseUse | LooseUse[]
  oneOf?: LooseRule[]
  rules?: LooseRule[]
  [key: string]: unknown
}

const isRefreshLoader = (use: LooseUse) =>
  typeof use === 'function'
    ? false
    : /react-refresh/.test(
        String(typeof use === 'string' ? use : use.loader || '')
      )

export function withoutDevRefresh(rules: LooseRule[]): LooseRule[] {
  return rules
    .map((rule): LooseRule | null => {
      if (!rule || typeof rule !== 'object') return rule
      if (rule.loader && /react-refresh/.test(rule.loader)) return null

      const next: LooseRule = {...rule}
      if (Array.isArray(next.oneOf)) next.oneOf = withoutDevRefresh(next.oneOf)
      if (Array.isArray(next.rules)) next.rules = withoutDevRefresh(next.rules)

      if (next.use !== undefined) {
        const list = (Array.isArray(next.use) ? next.use : [next.use])
          .filter((use) => !isRefreshLoader(use))
          .map(withoutSwcRefresh)
        next.use = Array.isArray(next.use) ? list : list[0]
      }

      return next
    })
    .filter((rule): rule is LooseRule => rule !== null)
}

// swc's refresh transform emits $RefreshReg$ calls only the dev runtime
// defines, so the flag is turned off for the child.
function withoutSwcRefresh(use: LooseUse): LooseUse {
  if (typeof use !== 'object' || use.loader !== 'builtin:swc-loader') return use

  const jsc = use.options?.jsc as
    | {transform?: {react?: {refresh?: unknown}}}
    | undefined
  if (!jsc?.transform?.react?.refresh) return use

  return {
    ...use,
    options: {
      ...use.options,
      jsc: {
        ...jsc,
        transform: {
          ...jsc.transform,
          react: {...jsc.transform.react, refresh: false}
        }
      }
    }
  }
}

// Entry name -> directory of the entry's first filesystem import, for
// approximating where a relocated page's source files live.
function collectEntrySourceDirs(compiler: Compiler): Map<string, string> {
  const entrySourceDirs = new Map<string, string>()
  const entryOption = compiler.options.entry

  if (entryOption && typeof entryOption === 'object') {
    for (const [name, desc] of Object.entries(entryOption)) {
      const imports: unknown[] = Array.isArray(
        (desc as {import?: unknown})?.import
      )
        ? (desc as {import: unknown[]}).import
        : typeof desc === 'string'
          ? [desc]
          : []
      const fsImport = imports.find(
        (imp): imp is string =>
          typeof imp === 'string' &&
          !imp.startsWith('data:') &&
          path.isAbsolute(imp)
      )
      if (fsImport) entrySourceDirs.set(name, path.dirname(fsImport))
    }
  }

  return entrySourceDirs
}

// True when the code carries the webpack chunk-loading runtime shape (the
// ChunkLoadError literal survives minification, unlike mangled identifiers).
function hasWebpackChunkLoadingRuntime(source: string): boolean {
  return (
    /\bwebpackChunk|\bwebpackJsonp\b/.test(source) ||
    source.includes('ChunkLoadError') ||
    (source.includes('__webpack_require__') && /\.p\s*\+/.test(source))
  )
}

// The source next to a missing .js literal (injected.ts for "injected.js"),
// which the build compiles to that .js name.
function findSourceSibling(abs: string): string | undefined {
  if (!abs.endsWith('.js')) return undefined

  const base = abs.slice(0, -'.js'.length)

  return SOURCE_SIBLING_EXTENSIONS.map((ext) => base + ext).find((candidate) =>
    isFile(candidate)
  )
}

function findStylesheetSibling(abs: string): string | undefined {
  const base = abs.slice(0, -'.css'.length)

  return STYLESHEET_SIBLING_EXTENSIONS.map((ext) => base + ext).find(
    (candidate) => isFile(candidate)
  )
}

// The .js path the build emits for a compiled source literal, or null when
// the literal already names a file the browser can load as-is.
export function compiledSourceEmittedPath(distRel: string): string | null {
  const ext = path.posix.extname(distRel)
  if (!COMPILED_TO_JS_EXTENSIONS.has(ext.toLowerCase())) return null

  return `${distRel.slice(0, -ext.length)}.js`
}

function unixify(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

// Resolve a runtime URL literal the way the browser does and return the
// extension-root-relative path, or null for non-same-origin references.
// tabs.create and friends resolve a relative url against the calling page,
// which moved in dist, so read it from the page's source folder instead.
function movedPageSourceBase(
  run: TraceRun,
  pageSources: Map<string, string>,
  assetName: string,
  literal: string,
  bare?: boolean
): string {
  const written = literal.trim()

  if (bare ? written.startsWith('/') : !/^\.\.?\//.test(written)) return ''
  // Background scripts run in a page the browser makes at the root.
  if (assetName === EMITTED_BACKGROUND_SCRIPTS_PATH) return ''

  const entryName = assetName.replace(/\.js$/i, '')
  const pageSource = pageSources.get(`${entryName}.html`)
  const entryDir = run.entrySourceDirs.get(entryName)
  const entryDirRel = entryDir
    ? unixify(path.relative(run.manifestDir, entryDir))
    : undefined
  const sourceRel =
    pageSource ||
    (entryDirRel === undefined
      ? ''
      : entryDirRel
        ? `${entryDirRel}/index.js`
        : 'index.js')

  if (!sourceRel || sourceRel.startsWith('..')) return ''

  const sourceDirRel = path.posix.dirname(sourceRel)
  if (sourceDirRel === path.posix.dirname(unixify(assetName))) return ''

  return sourceRel.replace(/^\.\//, '')
}

// Serves a compiled page at the path its author wrote too. Its markup names
// its script and sheet from the root, so the copy loads the same files.
function servePageAtAuthoredPath(
  run: TraceRun,
  authored: string,
  outputs: string[]
): string | undefined {
  const served = run.servedPages.get(authored)
  if (served) return served

  const emitted = outputs.filter(
    (output) => output !== authored && run.hasAsset(output)
  )
  if (emitted.length === 0 || run.hasAsset(authored)) return undefined

  const output = pageServedAtAuthoredPath(emitted)
  const page = run.compilation.getAsset(output)
  if (!page) return undefined

  run.compilation.emitAsset(authored, page.source)
  run.servedPages.set(authored, output)

  return output
}

function rewriteStringLiteral(
  compilation: Compilation,
  assetName: string,
  literal: string,
  replacement: string
) {
  const asset = compilation.getAsset(assetName)
  if (!asset) return

  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const quoted = new RegExp(`(['"\`])${escaped}\\1`, 'g')
  const content = asset.source.source().toString()
  const updated = content.replace(
    quoted,
    (_match, quote: string) => `${quote}${replacement}${quote}`
  )

  if (updated !== content) {
    compilation.updateAsset(assetName, new sources.RawSource(updated))
  }
}

export function resolveExtensionPath(
  literal: string,
  basePath: string
): string | null {
  const trimmed = literal.trim()
  if (!trimmed) return null
  if (/^[a-zA-Z][\w+.-]*:/.test(trimmed)) return null
  if (trimmed.startsWith('//')) return null

  try {
    const base = new URL(`chrome-extension://extension-js/${unixify(basePath)}`)
    const resolved = new URL(trimmed, base)
    if (resolved.hostname !== 'extension-js') return null

    const pathname = decodeURIComponent(resolved.pathname).replace(/^\/+/, '')

    return pathname || null
  } catch {
    return null
  }
}

// Source paths the manifest declares as compiled surfaces. These relocate in
// dist, so getURL tracing must not copy their raw sources through.
function manifestDeclaredSourcePaths(
  manifest: TracedManifest | undefined
): Set<string> {
  const declared = new Set<string>()
  if (!manifest) return declared

  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
      declared.add(unixify(value.trim()).replace(/^\/+/, '').split(/[?#]/)[0])
    }
  }

  add(manifest.background?.service_worker)
  add(manifest.background?.page)
  for (const script of manifest.background?.scripts ?? []) add(script)
  add(manifest.action?.default_popup)
  add(manifest.browser_action?.default_popup)
  add(manifest.page_action?.default_popup)
  add(manifest.options_page)
  add(manifest.options_ui?.page)
  add(manifest.devtools_page)
  add(manifest.side_panel?.default_path)
  add(manifest.sidebar_action?.default_panel)

  for (const page of Object.values(manifest.chrome_url_overrides ?? {})) {
    add(page)
  }

  // Content-script sources are deliberately NOT here: they bundle into
  // content_scripts/content-N.js, so nothing ever emits them at their source
  // path. A page that <script src>s a shared lib the content scripts also
  // declare (a common classic-scripts layout) still needs the raw file.
  return declared
}

// Every string under a manifest key the browsers do not define, plus custom
// keys nested in background, that is spelled like a file path.
function customManifestFileReferences(
  manifest: Record<string, unknown>
): Array<{key: string; literal: string}> {
  const refs: Array<{key: string; literal: string}> = []

  const collect = (key: string, value: unknown) => {
    if (typeof value === 'string') {
      const trimmed = value.trim()

      if (/\.[a-zA-Z0-9]{1,8}$/.test(trimmed) && !/\s/.test(trimmed)) {
        refs.push({key, literal: trimmed})
      }

      return
    }

    if (Array.isArray(value)) {
      for (const item of value) collect(key, item)

      return
    }

    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) collect(key, item)
    }
  }

  for (const [key, value] of Object.entries(manifest)) {
    if (!STANDARD_MANIFEST_KEYS.has(key)) {
      collect(key, value)
      continue
    }

    if (key !== 'background' || !value || typeof value !== 'object') continue

    for (const [subKey, subValue] of Object.entries(value)) {
      if (!STANDARD_BACKGROUND_KEYS.has(subKey)) {
        collect(`background.${subKey}`, subValue)
      }
    }
  }

  return refs
}

// Measured: Chromium opens a page path from the root and loads an image
// beside the caller. Firefox opens a page beside the caller.
function surfaceAddress(
  reads: SurfaceRead,
  browser: string
): ReferenceForm | 'unknown' {
  if (reads === 'panel') return 'unknown'

  // Chrome shows a panel page from the root for every form, measured from
  // a DevTools page the build moved. No Firefox run covers it.
  if (reads === 'panelPage') {
    return isChromiumBasedBrowser(browser) ? 'root' : 'unknown'
  }

  if (isGeckoBasedBrowser(browser)) return reads === 'page' ? 'own' : 'unknown'
  if (isChromiumBasedBrowser(browser)) return reads === 'page' ? 'root' : 'own'

  return 'unknown'
}

// Extract string-literal getURL arguments. Matching on `runtime.getURL(`
// keeps user-defined getURL functions out while surviving minification.
export function extractGetURLLiterals(source: string): string[] {
  const code = blankComments(source)
  const literals: string[] = []
  const callRe = /\bruntime\s*\.\s*getURL\s*\(/g

  let match: RegExpExecArray | null

  while ((match = callRe.exec(code))) {
    const args = readBalancedArgs(code, match.index + match[0].length - 1)
    if (args == null) continue

    const [first] = splitTopLevelArgs(args)
    const literal = first == null ? null : pureStringLiteral(first)
    if (literal != null) literals.push(literal)
  }

  return literals
}

const IMAGE_LITERAL_RE =
  /(['"])((?:\\.|(?!\1)[^\\])*\.(?:png|jpe?g|gif|svg|webp|ico))\1/gi

// Extract paths named at runtime and never in the manifest: HTML surfaces
// (setPopup/setOptions/createDocument/tabs.create), icons (setIcon,
// notifications.create) and devtools panels. Untraced they vanish from dist
// while the build stays green.
export function extractRuntimeSurfaceLiterals(source: string): string[] {
  return extractRuntimeSurfaceReferences(source).map((ref) => ref.literal)
}

// What the browser does with the path: opens it as a page, loads it as an
// image, shows it as a DevTools panel, or takes it as that panel's icon,
// which Chrome never fetches, so no run measured its address.
export type SurfaceRead = 'page' | 'image' | 'panel' | 'panelPage'

export interface SurfaceReference {
  literal: string
  reads: SurfaceRead
}

export function extractRuntimeSurfaceReferences(
  source: string
): SurfaceReference[] {
  const code = blankComments(source)
  const literals: SurfaceReference[] = []
  const calls = [
    {
      callRe: /\b(?:action|browserAction|pageAction)\s*\.\s*setPopup\s*\(/g,
      prop: 'popup',
      reads: 'page'
    },
    {
      callRe: /\bsidePanel\s*\.\s*setOptions\s*\(/g,
      prop: 'path',
      reads: 'page'
    },
    {
      callRe: /\bsidebarAction\s*\.\s*setPanel\s*\(/g,
      prop: 'panel',
      reads: 'page'
    },
    {
      callRe: /\boffscreen\s*\.\s*createDocument\s*\(/g,
      prop: 'url',
      reads: 'page'
    },
    {
      callRe: /\b(?:tabs|windows)\s*\.\s*create\s*\(/g,
      prop: 'url',
      reads: 'page'
    },
    {
      callRe: /\bnotifications\s*\.\s*create\s*\(/g,
      prop: 'iconUrl',
      reads: 'image'
    },
    {
      // The path value is a string or a size map, so every image literal
      // inside the call counts.
      callRe: /\b(?:action|browserAction|pageAction)\s*\.\s*setIcon\s*\(/g,
      images: true,
      reads: 'image'
    },
    {
      // panels.create(title, iconPath, pagePath): the two paths are positional.
      callRe: /\bpanels\s*\.\s*create\s*\(/g,
      positional: [1, 2],
      pageAt: 2,
      reads: 'panel'
    }
  ] as Array<{
    callRe: RegExp
    prop?: string
    images?: boolean
    positional?: number[]
    pageAt?: number
    reads: SurfaceRead
  }>

  for (const {callRe, prop, images, positional, pageAt, reads} of calls) {
    let match: RegExpExecArray | null

    while ((match = callRe.exec(code))) {
      const args = readBalancedArgs(code, match.index + match[0].length - 1)
      if (args == null) continue

      if (images) {
        IMAGE_LITERAL_RE.lastIndex = 0
        let imageMatch: RegExpExecArray | null

        while ((imageMatch = IMAGE_LITERAL_RE.exec(args))) {
          literals.push({literal: unescapeStringBody(imageMatch[2]), reads})
        }

        continue
      }

      if (positional) {
        const parts = splitTopLevelArgs(args)

        for (const index of positional) {
          const part = parts[index]
          const literal = part == null ? null : pureStringLiteral(part)

          if (literal?.trim()) {
            literals.push({
              literal,
              reads: index === pageAt ? 'panelPage' : reads
            })
          }
        }

        continue
      }

      const propRe = new RegExp(
        `["']?${prop}["']?\\s*:\\s*(['"])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`,
        'g'
      )
      let propMatch: RegExpExecArray | null

      while ((propMatch = propRe.exec(args))) {
        // An empty string is Chrome's "remove the popup" idiom, not a file.
        const literal = unescapeStringBody(propMatch[2])
        if (literal.trim()) literals.push({literal, reads})
      }
    }
  }

  return literals
}

// The address a sheet spells with the id the browser fills in, which is the
// one spelling Chromium reads from the extension in a sheet it injects.
const EXTENSION_ID_ADDRESS =
  /^(?:chrome|moz)-extension:\/\/__MSG_@@extension_id__\//i

// Extract url() and @import targets from a stylesheet the build copied as
// written, so the fonts and images it asks for ship with it.
export function extractCssSubresourceLiterals(css: string): string[] {
  const literals: string[] = []
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const refRe =
    /url\(\s*(?:(["'])([^"'\n]*)\1|([^"'()\s]+))\s*\)|@import\s+(["'])([^"'\n]+)\4/gi

  for (const match of code.matchAll(refRe)) {
    const literal = (match[2] ?? match[3] ?? match[5] ?? '')
      .trim()
      .replace(EXTENSION_ID_ADDRESS, '/')

    if (literal && !literal.startsWith('#')) literals.push(literal)
  }

  return literals
}

// Extract src/href attribute values from an HTML file copied through by
// getURL tracing, so the page's subresource closure ships with it.
function extractHtmlSubresourceLiterals(html: string): string[] {
  const literals: string[] = []
  const attrRe = /\b(?:src|href)\s*=\s*(["'])([^"']+)\1/gi

  let match: RegExpExecArray | null

  while ((match = attrRe.exec(html))) {
    literals.push(match[2])
  }

  return literals
}

// Extract module specifiers a raw (unbundled) ES module resolves against its
// own URL: static/dynamic imports and re-exports of ./ ../ or /-anchored files.
export function extractStaticImportLiterals(source: string): string[] {
  const code = blankComments(source)
  const literals: string[] = []
  const isFileSpecifier = (spec: string) =>
    spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')

  // import defaultName from "..." | import {a, b} from "..." |
  // import * as ns from "..." | import "..." | export ... from "..."
  const staticRe =
    /\b(?:import|export)\b\s*(?:[\w$]+\s*,?\s*)?(?:\*(?:\s*as\s+[\w$]+)?\s*|\{[^}]*\}\s*)?(?:from\s*)?(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g
  let match: RegExpExecArray | null

  while ((match = staticRe.exec(code))) {
    const spec = unescapeStringBody(match[2])
    if (isFileSpecifier(spec)) literals.push(spec)
  }

  // Literal dynamic import("./x.js") inside the copied module.
  const dynamicRe = /\bimport\s*\(/g

  while ((match = dynamicRe.exec(code))) {
    const args = readBalancedArgs(code, match.index + match[0].length - 1)
    if (args == null) continue

    const [first] = splitTopLevelArgs(args)
    const literal = first == null ? null : pureStringLiteral(first)
    if (literal != null && isFileSpecifier(literal)) literals.push(literal)
  }

  return literals
}

function extractImportScriptsLiterals(source: string): string[] {
  const code = blankComments(source)
  const literals: string[] = []
  const callRe = /\bimportScripts\s*\(/g

  let match: RegExpExecArray | null

  while ((match = callRe.exec(code))) {
    const args = readBalancedArgs(code, match.index + match[0].length - 1)
    if (args == null) continue

    for (const arg of splitTopLevelArgs(args)) {
      // Computed arguments (including the SDK's own chunk-loading runtime)
      // cannot be traced statically, only their literal branches can.
      literals.push(...conditionalStringLiterals(arg))
    }
  }

  return literals
}

// The string literals an expression can evaluate to through ?: branches.
function conditionalStringLiterals(expression: string, depth = 0): string[] {
  const literal = pureStringLiteral(expression)
  if (literal != null) return [literal]
  if (depth > 8) return []

  const trimmed = expression.trim()
  const unwrapped =
    trimmed.startsWith('(') &&
    readBalancedArgs(trimmed, 0) === trimmed.slice(1, -1)
      ? trimmed.slice(1, -1)
      : trimmed
  const branches = splitTopLevelConditional(unwrapped)
  if (!branches) return []

  return [
    ...conditionalStringLiterals(branches[0], depth + 1),
    ...conditionalStringLiterals(branches[1], depth + 1)
  ]
}

export function splitTopLevelConditional(
  expression: string
): [string, string] | null {
  let depth = 0
  let question = -1
  let pending = 0

  for (let i = 0; i < expression.length; i++) {
    const char = expression[i]

    if (char === '"' || char === "'" || char === '`') {
      i = skipString(expression, i, expression.length)
      continue
    }

    if (char === '(' || char === '[' || char === '{') depth++
    if (char === ')' || char === ']' || char === '}') depth--
    if (depth !== 0) continue

    const next = expression[i + 1]

    if (char === '?' && next !== '?' && next !== '.') {
      if (question < 0) question = i
      else pending++
    } else if (char === '?' && (next === '?' || next === '.')) {
      i++
    } else if (char === ':' && question >= 0) {
      if (pending > 0) {
        pending--
        continue
      }

      return [expression.slice(question + 1, i), expression.slice(i + 1)]
    }
  }

  return null
}

// The bundler's own chunk and hot update loader: public path plus a chunk
// file name. It names no file the author wrote, so it lists nothing.
const BUNDLER_CHUNK_URL = /^\s*([\w$]+)\.p\s*\+\s*\1\.\w+\(/

// The strings of an array literal, a name among them read where the
// literal lives. Strict: one element that is no string leaves no answer.
export function stringElements(
  found: ResolvedLiteral,
  strict: boolean
): string[] | null {
  if (!found.text.startsWith('[') || !found.text.endsWith(']')) return null

  const values: string[] = []

  for (const element of splitTopLevelArgs(found.text.slice(1, -1))) {
    const named = isConstantReference(element.trim())
      ? found.lookup(element, found.index)?.text
      : undefined
    const value = pureStringLiteral(named ?? element)

    if (value != null) values.push(value)
    else if (strict) return null
  }

  return values
}

// The strings a constant stands for where a path is expected: one string,
// or behind a spread a list of them. Null when that cannot be known.
export function constantStrings(
  lookup: LiteralLookup,
  expression: string,
  useIndex: number
): string[] | null {
  const trimmed = expression.trim()
  const spread = trimmed.startsWith('...')
  const reference = spread ? trimmed.slice(3).trim() : trimmed
  if (!isConstantReference(reference)) return null

  const found = lookup(reference, useIndex)
  if (!found) return null
  if (spread) return stringElements(found, true)

  const value = pureStringLiteral(found.text)

  return value == null ? null : [value]
}

// Every path an importScripts argument can be, both branches of a choice
// included, or null when one of them cannot be known.
function knownImportScriptsPaths(
  lookup: LiteralLookup,
  expression: string,
  useIndex: number,
  depth = 0
): string[] | null {
  const literal = pureStringLiteral(expression)
  if (literal != null) return [literal]
  if (depth > 8) return null

  const trimmed = expression.trim()
  const unwrapped =
    trimmed.startsWith('(') &&
    readBalancedArgs(trimmed, 0) === trimmed.slice(1, -1)
      ? trimmed.slice(1, -1)
      : trimmed
  const branches = splitTopLevelConditional(unwrapped)
  if (!branches) return constantStrings(lookup, unwrapped, useIndex)

  const whenTrue = knownImportScriptsPaths(
    lookup,
    branches[0],
    useIndex,
    depth + 1
  )
  const whenFalse = knownImportScriptsPaths(
    lookup,
    branches[1],
    useIndex,
    depth + 1
  )

  return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null
}

interface ImportScriptsVariablePaths {
  // Paths every variable argument is known to hold, named like a literal.
  named: string[]
  // Every script path the worker spells, when a variable cannot be known.
  candidates: string[]
}

// A variable fed to importScripts names its file when it is a constant.
// When it cannot be known, every script path the worker spells is listed.
function importScriptsVariablePaths(
  source: string
): ImportScriptsVariablePaths {
  const code = blankComments(source)
  const lookup = literalLookup(code)
  const callRe = /\bimportScripts\s*\(/g
  const named: string[] = []
  let unknown = false
  let call: RegExpExecArray | null

  while (!unknown && (call = callRe.exec(code))) {
    const args = readBalancedArgs(code, call.index + call[0].length - 1)
    if (args == null) continue

    for (const arg of splitTopLevelArgs(args)) {
      if (pureStringLiteral(arg) != null || BUNDLER_CHUNK_URL.test(arg)) {
        continue
      }

      const paths = knownImportScriptsPaths(lookup, arg, call.index)

      if (paths) named.push(...paths)
      else unknown = true
    }
  }

  if (!unknown) return {named, candidates: []}

  const candidates: string[] = []
  const scriptString = /(['"])((?:\\.|(?!\1)[^\\\n])*?\.m?js)\1/g
  let match: RegExpExecArray | null

  while ((match = scriptString.exec(code))) {
    const value = unescapeStringBody(match[2])
    if (!/^[a-z][\w+.-]*:/i.test(value)) candidates.push(value)
  }

  return {named: [], candidates}
}

interface PathEntry {
  value: string
  // Whether the path was read through a constant instead of written inline.
  viaConstant: boolean
}

type ElementResolver = (element: string) => string[] | null

// The paths of every `prop: [...]` list in the text. An element that is
// not a string is handed to the resolver, when one is given.
function arrayPropEntries(
  args: string,
  prop: string,
  resolve?: ElementResolver
): PathEntry[] {
  const entries: PathEntry[] = []
  const arrayRe = new RegExp(
    `(?<![\\w$.])["']?${escapeRegExp(prop)}["']?\\s*:\\s*\\[([^\\]]*)\\]`,
    'g'
  )
  let arrayMatch: RegExpExecArray | null

  while ((arrayMatch = arrayRe.exec(args))) {
    for (const element of splitTopLevelArgs(arrayMatch[1])) {
      const literal = pureStringLiteral(element)

      if (literal != null) {
        entries.push({value: literal, viaConstant: false})
        continue
      }

      for (const value of resolve?.(element) ?? []) {
        entries.push({value, viaConstant: true})
      }
    }
  }

  return entries
}

export interface RegisteredScriptGroup {
  text: string
  // Whether the text was read through a constant.
  viaConstant: boolean
  // What reads a name written in the text, and from where.
  lookup: LiteralLookup
  at: number
}

// The object literals a scripting call passes first, so a property is read
// per registration or injection instead of across the whole argument blob.
export function splitRegisteredScriptGroups(
  lookup: LiteralLookup,
  args: string,
  useIndex: number
): RegisteredScriptGroup[] {
  const [first] = splitTopLevelArgs(args)
  if (first == null) return []

  let trimmed = first.trim()
  let home = {lookup, at: useIndex}
  let viaConstant = false

  if (isConstantReference(trimmed)) {
    const found = lookup(trimmed, useIndex)
    if (!found) return []

    trimmed = found.text
    home = {lookup: found.lookup, at: found.index}
    viaConstant = true
  }

  if (!trimmed.startsWith('[')) return [{text: trimmed, viaConstant, ...home}]

  const close = trimmed.lastIndexOf(']')
  if (close < 1) return []

  const groups: RegisteredScriptGroup[] = []

  for (const element of splitTopLevelArgs(trimmed.slice(1, close))) {
    const text = element.trim()

    if (!isConstantReference(text)) {
      groups.push({text, viaConstant, ...home})
      continue
    }

    const found = home.lookup(text, home.at)

    if (found) {
      groups.push({
        text: found.text,
        viaConstant: true,
        lookup: found.lookup,
        at: found.index
      })
    }
  }

  return groups
}

const CONSTANT_REFERENCE = '[A-Za-z_$][\\w$]*(?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)?'

// The string literals of a const array a group names for a property, as
// `js: hookFiles`, `js: paths.HOOKS` or the shorthand `files`.
function constArrayPropStringLiterals(
  lookup: LiteralLookup,
  group: string,
  prop: string,
  useIndex: number
): string[] {
  const literals: string[] = []
  const name = escapeRegExp(prop)
  const namedRe = new RegExp(
    `(?<![\\w$.])["']?${name}["']?\\s*:\\s*(${CONSTANT_REFERENCE})\\s*(?=[,}])`,
    'g'
  )
  const shorthandRe = new RegExp(`[{,]\\s*(${name})\\s*(?=[,}])`, 'g')

  for (const match of [
    ...group.matchAll(namedRe),
    ...group.matchAll(shorthandRe)
  ]) {
    const found = lookup(match[1], useIndex)
    if (found) literals.push(...(stringElements(found, false) ?? []))
  }

  return literals
}

// The paths one group names under a property, inline or through a
// constant, each name read where the group itself is written.
export function groupPropEntries(
  group: RegisteredScriptGroup,
  prop: string
): PathEntry[] {
  return [
    ...arrayPropEntries(group.text, prop, (element) =>
      constantStrings(group.lookup, element, group.at)
    ),
    ...constArrayPropStringLiterals(
      group.lookup,
      group.text,
      prop,
      group.at
    ).map((value) => ({value, viaConstant: true}))
  ]
}

const SINGULAR_FILE = /["']?file["']?\s*:\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g
const SINGULAR_FILE_CONSTANT = new RegExp(
  `(?<![\\w$.])["']?file["']?\\s*:\\s*(${CONSTANT_REFERENCE})\\s*(?=[,}])`,
  'g'
)

// Cheap gate, so a source with no injection call is never tokenized.
const INJECTION_CALL =
  /\b(?:executeScript|insertCSS|removeCSS|registerContentScripts|updateContentScripts|contentScripts|userScripts|messageDisplayScripts|composeScripts)\b/

// Every path an injection call names, each marked with how it was read.
function collectInjectedFiles(
  source: string,
  readImported?: ImportedModuleReader
): PathEntry[] {
  // No injection call, no path to read, and nothing to tokenize for it.
  if (!INJECTION_CALL.test(source)) return []

  const code = blankComments(source)
  const lookup = literalLookup(code, readImported)
  const entries: PathEntry[] = []
  const calls = [
    {
      callRe: /\b(?:executeScript|insertCSS|removeCSS)\s*\(/g,
      arrayProps: ['files']
    },
    {
      callRe: /\b(?:registerContentScripts|updateContentScripts)\s*\(/g,
      arrayProps: ['js', 'css']
    },
    {
      // These name each script as {file: "..."}, read like the singular one.
      callRe:
        /\b(?:contentScripts|userScripts|messageDisplayScripts|composeScripts)\s*\.\s*register\s*\(/g,
      arrayProps: []
    }
  ]
  const constant = (value: string): PathEntry => ({value, viaConstant: true})

  // The paths a text names: `files`, `js` and `css` lists on the scripting
  // calls, and the singular `file` of MV2 tabs.executeScript and insertCSS.
  const read = (
    text: string,
    arrayProps: string[],
    from: {lookup: LiteralLookup; at: number},
    inline: boolean
  ) => {
    const found: PathEntry[] = []

    for (const prop of arrayProps) {
      found.push(
        ...arrayPropEntries(text, prop, (element) =>
          constantStrings(from.lookup, element, from.at)
        )
      )
    }

    for (const fileMatch of text.matchAll(SINGULAR_FILE)) {
      found.push({value: unescapeStringBody(fileMatch[2]), viaConstant: false})
    }

    for (const prop of arrayProps) {
      found.push(
        ...constArrayPropStringLiterals(from.lookup, text, prop, from.at).map(
          constant
        )
      )
    }

    for (const fileMatch of text.matchAll(SINGULAR_FILE_CONSTANT)) {
      found.push(
        ...(constantStrings(from.lookup, fileMatch[1], from.at) ?? []).map(
          constant
        )
      )
    }

    entries.push(
      ...(inline ? found : found.map((entry) => constant(entry.value)))
    )
  }

  for (const {callRe, arrayProps} of calls) {
    let match: RegExpExecArray | null

    while ((match = callRe.exec(code))) {
      const at = match.index
      const args = readBalancedArgs(code, at + match[0].length - 1)
      if (args == null) continue

      read(args, arrayProps, {lookup, at}, true)

      // A registration or an injection held whole in a constant.
      for (const group of splitRegisteredScriptGroups(lookup, args, at)) {
        if (group.viaConstant) read(group.text, arrayProps, group, false)
      }
    }
  }

  return entries
}

// Extract the file paths a runtime injection call ships to the browser. JS and
// CSS come back alike, the planner decides what compiles and what copies.
export function extractInjectedFileLiterals(
  source: string,
  readImported?: ImportedModuleReader
): string[] {
  return collectInjectedFiles(source, readImported).map((entry) => entry.value)
}

// The paths the injection calls of one source file name through a
// constant, the imports of that file followed to where they lead.
function constantInjectedFiles(
  file: string,
  resolveImport: () => LocalImportResolver
): string[] {
  const source = readScriptText(file)
  if (!source || !INJECTION_CALL.test(source)) return []

  const readImported: ImportedModuleReader = (specifier, fromFile = file) => {
    const resolved = resolveImport()(fromFile, specifier)
    const text = resolved ? readScriptText(resolved) : undefined

    return resolved && text != null ? {source: text, file: resolved} : null
  }

  return collectInjectedFiles(source, readImported)
    .filter((entry) => entry.viaConstant)
    .map((entry) => entry.value)
}

// The bases that all resolve to the asset's own URL at run time.
function isOwnLocationBase(expression: string): boolean {
  const base = expression.trim()

  return (
    /^(?:self\.|window\.|globalThis\.)?location(?:\.href)?$/.test(base) ||
    base === 'document.baseURI' ||
    base === 'import.meta.url'
  )
}

// Extract string-literal URLs loaded via same-origin request APIs: fetch(),
// xhr.open(method, url), new URL(url, own-location base). Computed args skip.
function extractFetchedFileLiterals(source: string): string[] {
  const code = blankComments(source)
  const literals: string[] = []
  let match: RegExpExecArray | null

  // fetch("data/config.json"), first argument only.
  const fetchRe = /\bfetch\s*\(/g

  while ((match = fetchRe.exec(code))) {
    const args = readBalancedArgs(code, match.index + match[0].length - 1)
    if (args == null) continue

    const [first] = splitTopLevelArgs(args)
    const literal = first == null ? null : pureStringLiteral(first)
    if (literal != null) literals.push(literal)
  }

  // xhr.open("GET", "data/config.json"), requiring a string-literal HTTP
  // method keeps window.open(...) and user methods named open() out.
  const openRe = /\bopen\s*\(/g

  while ((match = openRe.exec(code))) {
    const args = readBalancedArgs(code, match.index + match[0].length - 1)
    if (args == null) continue

    const parts = splitTopLevelArgs(args)
    if (parts.length < 2) continue

    const method = pureStringLiteral(parts[0])

    if (
      !method ||
      !/^(?:GET|POST|PUT|DELETE|HEAD|PATCH|OPTIONS)$/i.test(method)
    ) {
      continue
    }

    const literal = pureStringLiteral(parts[1])
    if (literal != null) literals.push(literal)
  }

  // new URL("data/x.json", import.meta.url | location | document.baseURI),
  // the allowlisted bases all resolve to the asset's own URL at runtime.
  const urlRe = /\bnew\s+URL\s*\(/g

  while ((match = urlRe.exec(code))) {
    const args = readBalancedArgs(code, match.index + match[0].length - 1)
    if (args == null) continue

    const parts = splitTopLevelArgs(args)
    if (parts.length !== 2) continue

    if (!isOwnLocationBase(parts[1])) continue

    const literal = pureStringLiteral(parts[0])
    if (literal != null) literals.push(literal)
  }

  return literals
}

// The scripts of background.scripts run in a page the browser generates at
// the root, so a relative path in them is read from there, not background/.
function ownAddressOf(assetName: string): string {
  return assetName === EMITTED_BACKGROUND_SCRIPTS_PATH ? '' : assetName
}

const OWN_FETCH_CALL =
  /(?<![\w$.])(?:(?:self|window|globalThis)\s*\.\s*)?fetch\s*\(/g
// A script that declares a fetch of its own may read a path any way it likes.
const DECLARES_FETCH =
  /\b(?:function|const|let|var|class)\s+fetch\b|(?<![\w$.])fetch\s*=(?!=)/

// Paths handed straight to the browser's own fetch or to a URL built on the
// script's address, both read against where the script or its page sits.
export function extractOwnAddressLiterals(source: string): string[] {
  const code = blankComments(source)
  const literals: string[] = []
  let match: RegExpExecArray | null

  if (!DECLARES_FETCH.test(code)) {
    OWN_FETCH_CALL.lastIndex = 0

    while ((match = OWN_FETCH_CALL.exec(code))) {
      const args = readBalancedArgs(code, match.index + match[0].length - 1)
      if (args == null) continue

      const [first] = splitTopLevelArgs(args)
      const literal = first == null ? null : pureStringLiteral(first)
      if (literal != null) literals.push(literal)
    }
  }

  const urlRe = /\bnew\s+URL\s*\(/g

  while ((match = urlRe.exec(code))) {
    const args = readBalancedArgs(code, match.index + match[0].length - 1)
    if (args == null) continue

    const parts = splitTopLevelArgs(args)
    if (parts.length !== 2 || !isOwnLocationBase(parts[1])) continue

    const literal = pureStringLiteral(parts[0])
    if (literal != null) literals.push(literal)
  }

  return literals
}

export type ReferenceForm = 'own' | 'root'

// What every mention of a path in one script proves: read against the
// script's address, or handed to getURL. A table or a variable proves neither.
export function provenReferenceForms(
  source: string,
  literals: string[],
  surfaces: Array<{literal: string; form: ReferenceForm | 'unknown'}> = []
): Map<string, ReferenceForm> {
  const tally = (values: string[]) => {
    const counts = new Map<string, number>()

    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)

    return counts
  }

  const handedTo = (form: ReferenceForm) =>
    surfaces.filter((ref) => ref.form === form).map((ref) => ref.literal)
  const own = tally([...extractOwnAddressLiterals(source), ...handedTo('own')])
  const root = tally([...extractGetURLLiterals(source), ...handedTo('root')])
  const forms = new Map<string, ReferenceForm>()

  for (const [literal, total] of tally(literals)) {
    const asOwn = own.get(literal) ?? 0
    const asRoot = root.get(literal) ?? 0

    if (asOwn === total && asRoot === 0) forms.set(literal, 'own')
    else if (asRoot === total && asOwn === 0) forms.set(literal, 'root')
  }

  return forms
}

// Reduce a same-origin URL literal to a filesystem-joinable path (query and
// hash stripped), or null for remote/other-scheme references.
function fetchLiteralToFsPath(literal: string): string | null {
  const trimmed = literal.trim()
  if (!trimmed) return null
  if (/^[a-zA-Z][\w+.-]*:/.test(trimmed)) return null
  if (trimmed.startsWith('//')) return null

  const noQuery = trimmed.split(/[?#]/)[0]

  return noQuery ? unixify(noQuery) : null
}
