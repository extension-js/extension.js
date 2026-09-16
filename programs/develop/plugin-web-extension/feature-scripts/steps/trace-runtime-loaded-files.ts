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
  EntryPlugin,
  javascript as rspackJavascript,
  library as rspackLibrary,
  sources,
  WebpackError
} from '@rspack/core'
import {filterKeysForThisBrowser} from '../../../lib/manifest-utils'
import type {DevOptions, Manifest} from '../../../types'
import {isClassicScript} from '../../shared/classic-concat'
import * as messages from '../messages'

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
}

const EMITTED_WORKER_PATH = 'background/service_worker.js'
// importScripts chains resolve against the worker URL, so depth only grows
// through files importing further files, 8 hops is far beyond real usage.
const MAX_TRACE_DEPTH = 8
const SOURCE_SIBLING_EXTENSIONS = ['.ts', '.mts', '.tsx', '.jsx', '.mjs']
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
}

export class TraceRuntimeLoadedFiles {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']

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

            for (let round = 0; round <= MAX_TRACE_DEPTH; round++) {
              this.traceWorkerImportScripts(run, only)
              this.traceInjectedFilePayloads(run, only)
              this.traceFetchedFiles(run, only)
              this.traceGetURLFiles(run, only)
              this.traceWebpackChunkSiblings(run, only)
              const emitted = await run.flushCompiles()
              if (emitted.length === 0) break

              only = new Set(emitted)
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
        JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8')) as Manifest,
        this.browser
      ) as TracedManifest
    } catch {
      return undefined
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
      if (asset) pending.push(asset.source.source().toString())
    }

    const seen = run.seen.importScripts

    for (let depth = 0; depth < MAX_TRACE_DEPTH && pending.length; depth++) {
      const next: string[] = []

      for (const content of pending) {
        for (const literal of extractImportScriptsLiterals(content)) {
          const sourceRel = resolveExtensionPath(literal, sourceWorkerPath)
          const distRel = resolveExtensionPath(literal, EMITTED_WORKER_PATH)
          if (!sourceRel || !distRel || seen.has(distRel)) continue

          seen.add(distRel)

          const plan = planTracedFile({
            manifestDir: run.manifestDir,
            sourceRel,
            distRel,
            loadsAs: 'classic',
            hasAsset: run.hasAsset
          })
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
          if (plan.kind !== 'missing' && sourceRel.endsWith('.js')) {
            copyIfExists(
              run.compilation,
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
      const content = asset.source.source().toString()

      for (const literal of extractFetchedFileLiterals(content)) {
        // Runtime resolution base is the asset's own URL directory: page
        // scripts sit beside their page in dist, workers fetch off the worker URL.
        const distRel = resolveExtensionPath(literal, asset.name)
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

        if (abs) {
          run.emitCopy(abs, distRel)
          continue
        }

        // Only extensioned paths warn: a bare "/v1/users"-style literal is far
        // likelier an API route than a file the author expected in the package.
        if (/\.[a-zA-Z0-9]{1,8}$/.test(distRel)) {
          run.warn(
            'RuntimeFetchedFileMissing',
            asset.name,
            messages.fetchedFileDependencyMissing(asset.name, literal, distRel)
          )
        }
      }
    }
  }

  private traceGetURLFiles(run: TraceRun, only?: Set<string>) {
    const declaredSurfaces = manifestDeclaredSourcePaths(this.readManifest())
    const seen = run.seen.getURL

    // getURL literals resolve against the extension ROOT regardless of context,
    // so, unlike relative fetch(), content scripts are traceable here.
    type PendingScan =
      | {kind: 'js'; content: string; assetName: string; copied?: boolean}
      | {kind: 'html'; content: string; baseRel: string}

    let pending: PendingScan[] = run.jsAssets(only).map((asset) => ({
      kind: 'js' as const,
      content: asset.source.source().toString(),
      assetName: asset.name
    }))

    // Copied files chain: a getURL'd classic script can call getURL again or
    // import() a module, and a copied HTML page has subresources. Compiled
    // files chain through the next round instead, once their output exists.
    for (let depth = 0; depth < MAX_TRACE_DEPTH && pending.length; depth++) {
      const next: PendingScan[] = []

      for (const item of pending) {
        type Ref = {
          literal: string
          baseRel: string
          isStaticImport?: boolean
          isRuntimeSurface?: boolean
        }
        const refs: Ref[] =
          item.kind === 'js'
            ? [
                ...extractGetURLLiterals(item.content).map((literal) => ({
                  literal,
                  baseRel: ''
                })),
                // Runtime-set HTML surfaces (setPopup/setOptions) resolve like
                // getURL but are not manifest refs; the page pipeline misses them.
                ...extractRuntimeSurfaceLiterals(item.content).map(
                  (literal) => ({
                    literal,
                    baseRel: '',
                    isRuntimeSurface: true
                  })
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
            : extractHtmlSubresourceLiterals(item.content).map((literal) => ({
                literal,
                baseRel: item.baseRel
              }))

        const assetName = item.kind === 'js' ? item.assetName : item.baseRel

        for (const {
          literal,
          baseRel,
          isStaticImport,
          isRuntimeSurface
        } of refs) {
          const distRel = resolveExtensionPath(literal, baseRel)
          if (!distRel || seen.has(distRel)) continue

          seen.add(distRel)

          // Manifest-declared page and background surfaces are compiled and
          // relocated by the main pipeline, copying their raw sources would
          // ship duplicates.
          if (declaredSurfaces.has(distRel)) continue

          // getURL paths are root-anchored, so source and dist paths match.
          const plan = planTracedFile({
            manifestDir: run.manifestDir,
            sourceRel: distRel,
            distRel,
            loadsAs: 'by-shape',
            hasAsset: run.hasAsset
          })
          const copied = run.apply(plan, {
            context: item.kind === 'html' ? 'html' : 'getURL',
            onMissing: () => {
              // Warn only for extensioned getURL misses found in JS: HTML
              // misses are the page author's problem, extensionless args
              // often origin math.
              if (item.kind !== 'js' || !/\.[a-zA-Z0-9]{1,8}$/.test(distRel)) {
                return
              }

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
                      distRel
                    )
                  : isRuntimeSurface
                    ? messages.runtimeSetSurfaceDependencyMissing(
                        assetName,
                        literal,
                        distRel
                      )
                    : messages.getURLDependencyMissing(
                        assetName,
                        literal,
                        distRel
                      )
              )
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
          }
        }
      }

      pending = next
    }
  }

  // Prebuilt webpack bundles are finished output, so their numeric chunks are
  // copied as-is.
  private traceWebpackChunkSiblings(run: TraceRun, only?: Set<string>) {
    const {compilation, manifestDir, entrySourceDirs} = run

    for (const asset of run.jsAssets(only)) {
      const content = asset.source.source().toString()
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
          copyIfExists(compilation, abs, file)

          if (assetDirRel && assetDirRel !== '.') {
            copyIfExists(compilation, abs, `${assetDirRel}/${file}`)
          }
        }
      }
    }
  }

  private traceInjectedFilePayloads(run: TraceRun, only?: Set<string>) {
    const seen = run.seen.injected

    for (const asset of run.jsAssets(only)) {
      const content = asset.source.source().toString()

      for (const literal of extractInjectedFileLiterals(content)) {
        const distRel = resolveExtensionPath(literal, '')
        if (!distRel || seen.has(distRel)) continue

        seen.add(distRel)

        const plan = planTracedFile({
          manifestDir: run.manifestDir,
          sourceRel: distRel,
          distRel,
          loadsAs: 'classic',
          hasAsset: run.hasAsset
        })
        run.apply(plan, {
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
      }
    }
  }
}

// One tracing pass over a compilation: the dedupe sets every step shares, the
// files queued for the bundler, and the emit helpers.
class TraceRun {
  readonly seen = {
    importScripts: new Set<string>(),
    injected: new Set<string>(),
    fetched: new Set<string>(),
    getURL: new Set<string>()
  }
  // Assets that execute in the worker's scope, so importScripts literals in
  // them resolve against the worker URL.
  readonly workerScope = new Set<string>([EMITTED_WORKER_PATH])
  readonly entrySourceDirs: Map<string, string>
  readonly hasAsset: (name: string) => boolean
  private readonly queue = new Map<string, CompileRequest>()

  constructor(
    readonly compilation: Compilation,
    readonly compiler: Compiler,
    readonly manifestDir: string
  ) {
    this.entrySourceDirs = collectEntrySourceDirs(compiler)
    this.hasAsset = (name) => Boolean(compilation.getAsset(name))
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
        return this.emitCopy(plan.sourcePath, plan.emitPath)

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

  emitCopy(abs: string, distRel: string): string {
    const buffer = fs.readFileSync(abs)
    this.compilation.emitAsset(distRel, new sources.RawSource(buffer))
    this.watch(abs)

    return buffer.toString()
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

  for (const format of ['module', 'classic'] as const) {
    const group = requests.filter((request) => request.format === format)
    if (group.length === 0) continue

    await compileTracedFiles({compilation, compiler}, format, group)
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
}): TracedFilePlan {
  const {manifestDir, sourceRel, distRel, loadsAs, hasAsset} = opts

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
    if (!SCRIPT_EXTENSIONS.has(ext)) {
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

    if (sibling) {
      return {
        kind: 'compile',
        sourcePath: sibling,
        emitPath: distRel,
        format: formatFor(sibling, loadsAs)
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

// Compile traced sources in a child of the main compilation, one per output
// format, so they get the same loaders and resolution as every entry. The
// child's assets land in the parent at the paths the runtime asks for.
async function compileTracedFiles(
  host: CompileHost,
  format: TracedFormat,
  requests: CompileRequest[]
): Promise<void> {
  const {compilation, compiler} = host
  const isModule = format === 'module'
  const chunkLoadingFor = (context: LoadContext) =>
    isModule
      ? 'import'
      : context === 'importScripts'
        ? 'import-scripts'
        : 'jsonp'

  const entries = requests.map(
    (request) =>
      new EntryPlugin(compiler.context, request.sourcePath, {
        name: request.emitPath.replace(/\.[^./]+$/, ''),
        filename: request.emitPath,
        chunkLoading: chunkLoadingFor(request.context),
        ...(isModule ? {library: {type: 'module'}} : {})
      })
  )

  const child = compilation.createChildCompiler(
    `${TraceRuntimeLoadedFiles.name}:${format}`,
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
    entries
  )

  // Applied after the inherited builtins: the module library marks the
  // entry's exports as used when it runs, which must come after provided
  // exports are known or production tree-shakes every export away.
  for (const type of new Set(
    requests.map((request) => chunkLoadingFor(request.context))
  )) {
    new rspackJavascript.EnableChunkLoadingPlugin(type).apply(child)
  }

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
    rules: withoutDevRefresh(
      child.options.module.rules as LooseRule[]
    ) as typeof child.options.module.rules
  }

  await new Promise<void>((resolve) => {
    child.runAsChild((error, _entries, childCompilation) => {
      if (error) {
        const failure = new WebpackError(
          `Compiling runtime-loaded ${requests
            .map((request) => request.emitPath)
            .join(', ')} failed: ${error.message}`
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

      resolve()
    })
  })
}

function withEagerDynamicImports(
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

function withoutDevRefresh(rules: LooseRule[]): LooseRule[] {
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

function copyIfExists(
  compilation: Compilation,
  abs: string,
  distRel: string
): void {
  if (compilation.getAsset(distRel)) return
  if (!isFile(abs)) return

  compilation.emitAsset(distRel, new sources.RawSource(fs.readFileSync(abs)))

  try {
    compilation.fileDependencies.add(abs)
  } catch {
    // Ignore, watch registration is best-effort
  }
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

// Extract string-literal getURL arguments. Matching on `runtime.getURL(`
// keeps user-defined getURL functions out while surviving minification.
function extractGetURLLiterals(source: string): string[] {
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

// Extract HTML surface paths set at runtime (setPopup/setOptions/
// createDocument): never manifest refs, so untraced they vanish from dist.
export function extractRuntimeSurfaceLiterals(source: string): string[] {
  const code = blankComments(source)
  const literals: string[] = []
  const calls = [
    {
      callRe: /\b(?:action|browserAction|pageAction)\s*\.\s*setPopup\s*\(/g,
      prop: 'popup'
    },
    {callRe: /\bsidePanel\s*\.\s*setOptions\s*\(/g, prop: 'path'},
    {callRe: /\boffscreen\s*\.\s*createDocument\s*\(/g, prop: 'url'}
  ]

  for (const {callRe, prop} of calls) {
    let match: RegExpExecArray | null

    while ((match = callRe.exec(code))) {
      const args = readBalancedArgs(code, match.index + match[0].length - 1)
      if (args == null) continue

      const propRe = new RegExp(
        `["']?${prop}["']?\\s*:\\s*(['"])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`,
        'g'
      )
      let propMatch: RegExpExecArray | null

      while ((propMatch = propRe.exec(args))) {
        // An empty string is Chrome's "remove the popup" idiom, not a file.
        const literal = unescapeStringBody(propMatch[2])
        if (literal.trim()) literals.push(literal)
      }
    }
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
      const literal = pureStringLiteral(arg)
      // Computed arguments (including the SDK's own chunk-loading runtime)
      // cannot be traced statically, skip them silently.
      if (literal != null) literals.push(literal)
    }
  }

  return literals
}

// Extract the file paths a runtime injection call ships to the browser. JS and
// CSS come back alike, the planner decides what compiles and what copies.
export function extractInjectedFileLiterals(source: string): string[] {
  const code = blankComments(source)
  const literals: string[] = []
  const calls = [
    {
      callRe: /\b(?:executeScript|insertCSS|removeCSS)\s*\(/g,
      arrayProps: ['files']
    },
    {
      callRe: /\b(?:registerContentScripts|updateContentScripts)\s*\(/g,
      arrayProps: ['js', 'css']
    }
  ]

  for (const {callRe, arrayProps} of calls) {
    let match: RegExpExecArray | null

    while ((match = callRe.exec(code))) {
      const args = readBalancedArgs(code, match.index + match[0].length - 1)
      if (args == null) continue

      // `files: [...]` on chrome.scripting.*, `js: [...]` and `css: [...]` on
      // registered content scripts, arrays of literals.
      for (const prop of arrayProps) {
        const arrayRe = new RegExp(
          `(?<![\\w$.])["']?${prop}["']?\\s*:\\s*\\[([^\\]]*)\\]`,
          'g'
        )
        let arrayMatch: RegExpExecArray | null

        while ((arrayMatch = arrayRe.exec(args))) {
          for (const element of splitTopLevelArgs(arrayMatch[1])) {
            const literal = pureStringLiteral(element)
            if (literal != null) literals.push(literal)
          }
        }
      }

      // MV2 tabs.executeScript / tabs.insertCSS, `file: "..."` singular.
      const fileRe = /["']?file["']?\s*:\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g
      let fileMatch: RegExpExecArray | null

      while ((fileMatch = fileRe.exec(args))) {
        literals.push(unescapeStringBody(fileMatch[2]))
      }
    }
  }

  return literals
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

    const base = parts[1].trim()
    const ownLocationBase =
      /^(?:self\.|window\.|globalThis\.)?location(?:\.href)?$/.test(base) ||
      base === 'document.baseURI' ||
      base === 'import.meta.url'
    if (!ownLocationBase) continue

    const literal = pureStringLiteral(parts[0])
    if (literal != null) literals.push(literal)
  }

  return literals
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

// Blank out line and block comments (string-aware) so commented-out calls do
// not produce copies or warnings; contents become spaces to keep offsets.
function blankComments(source: string): string {
  let out = ''
  let i = 0
  const n = source.length

  while (i < n) {
    const char = source[i]
    const next = source[i + 1]

    if (char === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out += ' '
        i++
      }

      continue
    }

    if (char === '/' && next === '*') {
      out += '  '
      i += 2

      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' '
        i++
      }

      if (i < n) {
        out += '  '
        i += 2
      }

      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      // Copy the whole string token verbatim, template interpolations
      // included, so nested backticks cannot desync the comment scan.
      const end = skipString(source, i, n)
      out += source.slice(i, Math.min(end + 1, n))
      i = end + 1
      continue
    }

    out += char
    i++
  }

  return out
}

// Return the argument text up to the matching close paren (string-aware), or
// null when unbalanced. No size cap: minified args can span many kilobytes.
function readBalancedArgs(code: string, openIndex: number): string | null {
  if (code[openIndex] !== '(') return null

  const cap = code.length
  let depth = 0

  for (let i = openIndex; i < cap; i++) {
    const char = code[i]

    if (char === '"' || char === "'" || char === '`') {
      i = skipString(code, i, cap)
      continue
    }

    if (char === '(') depth++

    if (char === ')') {
      depth--
      if (depth === 0) return code.slice(openIndex + 1, i)
    }
  }

  return null
}

// Return the index of the closing quote, skipping template `${...}` blocks;
// without this a nested backtick desyncs every scanner downstream.
function skipString(code: string, start: number, cap: number): number {
  const quote = code[start]

  for (let i = start + 1; i < cap; i++) {
    if (code[i] === '\\') {
      i++
      continue
    }

    if (code[i] === quote) return i

    if (quote === '`' && code[i] === '$' && code[i + 1] === '{') {
      i = skipTemplateExpression(code, i + 2, cap)
    }
  }

  return cap
}

// Given the index just past `${`, return the index of the matching `}` (or
// cap), skipping nested strings, templates, and object literals.
function skipTemplateExpression(
  code: string,
  start: number,
  cap: number
): number {
  let depth = 1

  for (let i = start; i < cap; i++) {
    const char = code[i]

    if (char === '"' || char === "'" || char === '`') {
      i = skipString(code, i, cap)
      continue
    }

    if (char === '{') depth++

    if (char === '}') {
      depth--
      if (depth === 0) return i
    }
  }

  return cap
}

function splitTopLevelArgs(args: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''

  for (let i = 0; i < args.length; i++) {
    const char = args[i]

    if (char === '"' || char === "'" || char === '`') {
      const end = skipString(args, i, args.length)
      current += args.slice(i, end + 1)
      i = end
      continue
    }

    if (char === '(' || char === '[' || char === '{') depth++
    if (char === ')' || char === ']' || char === '}') depth--

    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }

    current += char
  }

  if (current.trim()) parts.push(current)

  return parts
}

// Return the string value when the whole argument is a single static string
// literal; null for identifiers, concatenations, and template interpolation.
function pureStringLiteral(arg: string): string | null {
  const match = /^\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*$/.exec(arg)
  if (!match) return null
  if (match[1] === '`' && match[2].includes('${')) return null

  return unescapeStringBody(match[2])
}

function unescapeStringBody(body: string): string {
  return body.replace(/\\(.)/g, '$1')
}
