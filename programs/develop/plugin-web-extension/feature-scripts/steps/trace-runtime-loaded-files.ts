// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {Compilation, type Compiler, sources, WebpackError} from '@rspack/core'
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

export class TraceRuntimeLoadedFiles {
  public readonly manifestPath: string

  constructor(options: {manifestPath: string}) {
    this.manifestPath = options.manifestPath
  }

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      TraceRuntimeLoadedFiles.name,
      (compilation) => {
        // SUMMARIZE runs after minification: the copied files stay verbatim
        // (classic scripts share top-level globals, so they must not be
        // minified or wrapped), and the scan sees the final user bundles but
        // not the dev-server runtimes injected at the REPORT stages (whose
        // chunk-loading code calls importScripts with computed URLs).
        compilation.hooks.processAssets.tap(
          {
            name: TraceRuntimeLoadedFiles.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
          },
          () => {
            this.traceWorkerImportScripts(compilation)
            this.traceInjectedFilePayloads(compilation)
            this.traceFetchedFiles(compilation, compiler)
            this.traceGetURLFiles(compilation)
            this.traceWebpackChunkSiblings(compilation, compiler)
          }
        )
      }
    )
  }

  private readManifest(): TracedManifest | undefined {
    try {
      return JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'))
    } catch {
      return undefined
    }
  }

  private traceWorkerImportScripts(compilation: Compilation) {
    const manifest = this.readManifest()
    const workerRef = manifest?.background?.service_worker
    // Module workers cannot legally call importScripts.
    if (!workerRef || manifest?.background?.type === 'module') return

    const workerAsset = compilation.getAsset(EMITTED_WORKER_PATH)
    if (!workerAsset) return

    const manifestDir = path.dirname(this.manifestPath)
    const sourceWorkerPath = unixify(String(workerRef)).replace(/^\/+/, '')

    let pending = [workerAsset.source.source().toString()]
    const seen = new Set<string>()

    for (let depth = 0; depth < MAX_TRACE_DEPTH && pending.length; depth++) {
      const next: string[] = []

      for (const content of pending) {
        for (const literal of extractImportScriptsLiterals(content)) {
          const sourceRel = resolveExtensionPath(literal, sourceWorkerPath)
          const distRel = resolveExtensionPath(literal, EMITTED_WORKER_PATH)
          if (!sourceRel || !distRel || seen.has(distRel)) continue
          seen.add(distRel)

          const copied = copyThroughOrWarn(compilation, {
            manifestDir,
            sourceRel,
            distRel,
            warning: (expected, sourceSibling) =>
              messages.importScriptsDependencyMissing(
                sourceWorkerPath,
                literal,
                expected,
                sourceSibling
              ),
            warningName: 'ImportScriptsDependencyMissing',
            warningFile: EMITTED_WORKER_PATH
          })

          // Imported classic scripts may chain further importScripts calls;
          // those still resolve against the worker URL, not the file's own.
          if (copied != null) {
            next.push(copied)

            // wasm-bindgen --target no-modules pairs X.js with X_bg.wasm and
            // fetches it relative to the worker (the first-party Chrome
            // sample does exactly this). The fetch itself is computed, so
            // copy the sibling through when it exists, silently otherwise.
            if (sourceRel.endsWith('.js')) {
              copyIfExists(
                compilation,
                path.join(manifestDir, sourceRel.replace(/\.js$/, '_bg.wasm')),
                distRel.replace(/\.js$/, '_bg.wasm')
              )
            }
          }
        }
      }

      pending = next
    }
  }

  private traceFetchedFiles(compilation: Compilation, compiler: Compiler) {
    const manifestDir = path.dirname(this.manifestPath)
    const seen = new Set<string>()

    // fetch() and friends resolve against the PAGE URL, and pages get
    // relocated in dist (popup.html -> action/index.html), so the author's
    // relative base is gone from the emitted layout. The entry's source dir
    // approximates it for the common page-keeps-its-files-beside-it layouts.
    const entrySourceDirs = collectEntrySourceDirs(compiler)

    // Content scripts (and scripts/ folder helpers, which are injected into
    // pages) run inside web pages, where a relative fetch() resolves against
    // the WEBSITE, nothing of theirs can be traced into the package.
    const jsAssets = compilation
      .getAssets()
      .filter(
        (asset) =>
          /\.js$/i.test(asset.name) &&
          !asset.name.startsWith('content_scripts/') &&
          !asset.name.startsWith('scripts/')
      )

    for (const asset of jsAssets) {
      const content = asset.source.source().toString()

      for (const literal of extractFetchedFileLiterals(content)) {
        // Runtime resolution base is the asset's own URL directory: page
        // scripts sit beside their page in dist, and workers fetch against
        // the worker URL.
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
            fs.existsSync(candidate) &&
            fs.statSync(candidate).isFile()
        )

        if (abs) {
          compilation.emitAsset(
            distRel,
            new sources.RawSource(fs.readFileSync(abs))
          )
          try {
            compilation.fileDependencies.add(abs)
          } catch {
            // ignore, watch registration is best-effort
          }
          continue
        }

        // Only extensioned paths warn: a bare "/v1/users"-style literal is
        // far likelier an API route on a user-configured host than a file
        // the author expected in the package.
        if (/\.[a-zA-Z0-9]{1,8}$/.test(distRel)) {
          const warn = new WebpackError(
            messages.fetchedFileDependencyMissing(asset.name, literal, distRel)
          ) as Error & {file?: string; name?: string}
          warn.name = 'RuntimeFetchedFileMissing'
          warn.file = asset.name
          compilation.warnings ||= []
          compilation.warnings.push(warn)
        }
      }
    }
  }

  private traceGetURLFiles(compilation: Compilation) {
    const manifestDir = path.dirname(this.manifestPath)
    const declaredSurfaces = manifestDeclaredSourcePaths(this.readManifest())
    const seen = new Set<string>()

    // chrome.runtime.getURL literals resolve against the extension ROOT
    // regardless of the calling context, so, unlike relative fetch(),
    // content scripts and scripts/ helpers are traceable here.
    type PendingScan =
      | {kind: 'js'; content: string; assetName: string; copied?: boolean}
      | {kind: 'html'; content: string; baseRel: string}

    let pending: PendingScan[] = compilation
      .getAssets()
      .filter((asset) => /\.js$/i.test(asset.name))
      .map((asset) => ({
        kind: 'js' as const,
        content: asset.source.source().toString(),
        assetName: asset.name
      }))

    // Copied files chain: a getURL'd module can call getURL again, a copied
    // raw module keeps its static relative import/export-from graph (Chrome
    // resolves those against the module's own URL. The root must not ship
    // without its siblings), and a getURL'd HTML page pulls its own src/href
    // subresources along (the redirect-stub-to-real-page pattern).
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
                // Runtime-set HTML surfaces (setPopup/setOptions) resolve
                // against the extension root exactly like getURL, but are
                // not manifest refs, so the page pipeline never sees them.
                ...extractRuntimeSurfaceLiterals(item.content).map(
                  (literal) => ({
                    literal,
                    baseRel: '',
                    isRuntimeSurface: true
                  })
                ),
                // Only files WE copied verbatim: emitted bundles had their
                // static imports resolved by the bundler already.
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

        for (const {
          literal,
          baseRel,
          isStaticImport,
          isRuntimeSurface
        } of refs) {
          const distRel = resolveExtensionPath(literal, baseRel)
          if (!distRel || seen.has(distRel)) continue
          seen.add(distRel)

          // Manifest-declared surfaces are compiled and relocated by the
          // main pipeline, copying their raw sources would ship stale
          // duplicates.
          if (declaredSurfaces.has(distRel)) continue
          if (compilation.getAsset(distRel)) continue
          // public/ files land at the output root via the special-folders
          // pipeline.
          if (fs.existsSync(path.join(manifestDir, 'public', distRel))) continue

          // getURL paths are root-anchored, so source and dist paths match.
          const abs = path.join(manifestDir, distRel)
          if (
            !path.relative(manifestDir, abs).startsWith('..') &&
            fs.existsSync(abs) &&
            fs.statSync(abs).isFile()
          ) {
            const buffer = fs.readFileSync(abs)
            compilation.emitAsset(distRel, new sources.RawSource(buffer))
            try {
              compilation.fileDependencies.add(abs)
            } catch {
              // ignore, watch registration is best-effort
            }
            if (/\.(?:js|mjs)$/i.test(distRel)) {
              next.push({
                kind: 'js',
                content: buffer.toString(),
                assetName: distRel,
                copied: true
              })
            } else if (/\.html?$/i.test(distRel)) {
              next.push({
                kind: 'html',
                content: buffer.toString(),
                baseRel: distRel
              })
            }
            continue
          }

          // Warn only for extensioned getURL misses found in JS: HTML
          // subresource misses inherit the page author's problem, and
          // extensionless getURL args are often origin/base computations.
          if (item.kind === 'js' && /\.[a-zA-Z0-9]{1,8}$/.test(distRel)) {
            const warn = new WebpackError(
              isStaticImport
                ? messages.staticImportDependencyMissing(
                    item.assetName,
                    literal,
                    distRel
                  )
                : isRuntimeSurface
                  ? messages.runtimeSetSurfaceDependencyMissing(
                      item.assetName,
                      literal,
                      distRel
                    )
                  : messages.getURLDependencyMissing(
                      item.assetName,
                      literal,
                      distRel
                    )
            ) as Error & {file?: string; name?: string}
            warn.name = isStaticImport
              ? 'RuntimeStaticImportFileMissing'
              : isRuntimeSurface
                ? 'RuntimeSetSurfaceFileMissing'
                : 'RuntimeGetURLFileMissing'
            warn.file = item.assetName
            compilation.warnings ||= []
            compilation.warnings.push(warn)
          }
        }
      }

      pending = next
    }
  }

  private traceWebpackChunkSiblings(
    compilation: Compilation,
    compiler: Compiler
  ) {
    const manifestDir = path.dirname(this.manifestPath)
    const entrySourceDirs = collectEntrySourceDirs(compiler)

    const jsAssets = compilation
      .getAssets()
      .filter((asset) => /\.js$/i.test(asset.name))

    for (const asset of jsAssets) {
      const content = asset.source.source().toString()
      if (!hasWebpackChunkLoadingRuntime(content)) continue

      // Prebuilt webpack bundles address lazy chunks by NUMERIC id through
      // publicPath concatenation (`__webpack_require__.p + id + ".js"` and
      // the miniCss twin), so the chunk filenames never exist as literals
      // anywhere, literal tracing is blind to them by construction. Numeric
      // js/css siblings of the bundle's source dir ARE those chunks; copy
      // them through verbatim (plus .map twins).
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

  private traceInjectedFilePayloads(compilation: Compilation) {
    const manifestDir = path.dirname(this.manifestPath)
    const seen = new Set<string>()

    // Snapshot first: importScripts tracing above may have emitted classic
    // worker deps, and those can themselves call chrome.scripting APIs.
    const jsAssets = compilation
      .getAssets()
      .filter((asset) => /\.js$/i.test(asset.name))

    for (const asset of jsAssets) {
      const content = asset.source.source().toString()

      for (const literal of extractInjectedFileLiterals(content)) {
        const distRel = resolveExtensionPath(literal, '')
        if (!distRel || seen.has(distRel)) continue
        seen.add(distRel)

        copyThroughOrWarn(compilation, {
          manifestDir,
          sourceRel: distRel,
          distRel,
          warning: (expected, sourceSibling) =>
            messages.injectedFileDependencyMissing(
              asset.name,
              literal,
              expected,
              sourceSibling
            ),
          warningName: 'InjectedScriptFilesMissing',
          warningFile: asset.name
        })
      }
    }
  }
}

/**
 * Entry name -> directory of the entry's first filesystem import, for
 * approximating where a relocated page's source files live.
 */
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

/**
 * True when the code carries the webpack chunk-loading runtime shape:
 * the webpackChunk/webpackJsonp global arrays, the runtime's own
 * ChunkLoadError literal (survives minification, unlike the mangled
 * __webpack_require__ identifier), or an unminified publicPath
 * concatenation.
 */
function hasWebpackChunkLoadingRuntime(source: string): boolean {
  return (
    /\bwebpackChunk|\bwebpackJsonp\b/.test(source) ||
    source.includes('ChunkLoadError') ||
    (source.includes('__webpack_require__') && /\.p\s*\+/.test(source))
  )
}

/** Copy a file through verbatim when it exists; no warning otherwise. */
function copyIfExists(
  compilation: Compilation,
  abs: string,
  distRel: string
): void {
  if (compilation.getAsset(distRel)) return
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return
  compilation.emitAsset(distRel, new sources.RawSource(fs.readFileSync(abs)))
  try {
    compilation.fileDependencies.add(abs)
  } catch {
    // ignore, watch registration is best-effort
  }
}

/**
 * Copy a runtime-loaded file through to the output verbatim, or push a build
 * warning when the referenced file cannot be found. Returns the file content
 * when a copy happened (callers may want to scan it further), null otherwise.
 */
function copyThroughOrWarn(
  compilation: Compilation,
  opts: {
    manifestDir: string
    sourceRel: string
    distRel: string
    warning: (expectedPath: string, sourceSibling?: string) => string
    warningName: string
    warningFile: string
  }
): string | null {
  // Already produced by the compilation (an emitted chunk or a previously
  // copied file), nothing to do.
  if (compilation.getAsset(opts.distRel)) return null

  // Files under public/ are copied to the output root by the special-folders
  // pipeline; don't double-emit or warn about those.
  if (fs.existsSync(path.join(opts.manifestDir, 'public', opts.distRel))) {
    return null
  }

  const abs = path.join(opts.manifestDir, opts.sourceRel)

  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
    const buffer = fs.readFileSync(abs)
    compilation.emitAsset(opts.distRel, new sources.RawSource(buffer))
    try {
      compilation.fileDependencies.add(abs)
    } catch {
      // ignore, watch registration is best-effort
    }
    return buffer.toString()
  }

  const sourceSibling = findSourceSibling(abs)
  const warn = new WebpackError(
    opts.warning(
      opts.sourceRel,
      sourceSibling
        ? unixify(path.relative(opts.manifestDir, sourceSibling))
        : undefined
    )
  ) as Error & {file?: string; name?: string}
  warn.name = opts.warningName
  warn.file = opts.warningFile
  compilation.warnings ||= []
  compilation.warnings.push(warn)
  return null
}

/**
 * The literal may have been authored against a source file that compiles to
 * .js (e.g. `injected.ts` referenced as "injected.js"). Surface that in the
 * warning so authors know these files are copied as-is, not compiled.
 */
function findSourceSibling(abs: string): string | undefined {
  if (!abs.endsWith('.js')) return undefined
  const base = abs.slice(0, -'.js'.length)
  return SOURCE_SIBLING_EXTENSIONS.map((ext) => base + ext).find((candidate) =>
    fs.existsSync(candidate)
  )
}

function unixify(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

/**
 * Resolve a runtime URL literal the way the browser does, against a base
 * path inside the extension origin, and return the extension-root-relative
 * output path, or null for anything that isn't a same-origin file reference
 * (remote URLs, other schemes, protocol-relative URLs).
 */
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

/**
 * Source paths the manifest declares as compiled surfaces (pages, workers,
 * content scripts). These relocate in dist, so getURL tracing must not copy
 * their raw sources through, the main pipeline owns them.
 */
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
  for (const contentScript of manifest.content_scripts ?? []) {
    for (const js of contentScript?.js ?? []) add(js)
    for (const css of contentScript?.css ?? []) add(css)
  }

  return declared
}

/**
 * Extract string-literal arguments of chrome.runtime.getURL /
 * browser.runtime.getURL calls. Matching on `runtime.getURL(` keeps aliased
 * or user-defined getURL functions out while surviving minification (the
 * chrome global's member chain is never mangled). Computed arguments cannot
 * be traced statically and are skipped.
 */
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

/**
 * Extract HTML surface paths set at runtime: chrome.action.setPopup(
 * {popup: "Alt.html"}) (plus browserAction/pageAction MV2 variants) and
 * chrome.sidePanel.setOptions({path: "panel.html"}). Chrome resolves these
 * against the extension root, but they are not manifest refs, so the page
 * pipeline never compiles them, untraced they silently vanish from dist and
 * the surface opens a 404 panel. Matching on the member chain
 * (`action.setPopup(`) keeps user-defined functions out while surviving
 * minification, mirroring extractGetURLLiterals.
 */
export function extractRuntimeSurfaceLiterals(source: string): string[] {
  const code = blankComments(source)
  const literals: string[] = []
  const calls = [
    {
      callRe: /\b(?:action|browserAction|pageAction)\s*\.\s*setPopup\s*\(/g,
      prop: 'popup'
    },
    {callRe: /\bsidePanel\s*\.\s*setOptions\s*\(/g, prop: 'path'}
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

/**
 * Extract src/href attribute values from an HTML file copied through by
 * getURL tracing, so the page's subresource closure ships with it. Remote
 * and other-scheme URLs are filtered later by resolveExtensionPath.
 */
function extractHtmlSubresourceLiterals(html: string): string[] {
  const literals: string[] = []
  const attrRe = /\b(?:src|href)\s*=\s*(["'])([^"']+)\1/gi

  let match: RegExpExecArray | null
  while ((match = attrRe.exec(html))) {
    literals.push(match[2])
  }

  return literals
}

/**
 * Extract module specifiers a raw (unbundled) ES module resolves against its
 * own URL at runtime: static `import ... from "./x.js"`, side-effect
 * `import "./x.js"`, re-exports (`export {a} from` / `export * from`), and
 * literal dynamic `import("./x.js")`. Only same-origin file specifiers
 * (./ ../ or /-anchored) qualify, bare package specifiers cannot resolve in
 * the browser and belong to the bundler, not the copy-through path.
 */
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

function extractInjectedFileLiterals(source: string): string[] {
  const code = blankComments(source)
  const literals: string[] = []
  const callRe = /\b(?:executeScript|insertCSS|removeCSS)\s*\(/g

  let match: RegExpExecArray | null
  while ((match = callRe.exec(code))) {
    const args = readBalancedArgs(code, match.index + match[0].length - 1)
    if (args == null) continue

    // MV3 chrome.scripting.*, `files: [...]` arrays of literals.
    const filesRe = /["']?files["']?\s*:\s*\[([^\]]*)\]/g
    let filesMatch: RegExpExecArray | null
    while ((filesMatch = filesRe.exec(args))) {
      for (const element of splitTopLevelArgs(filesMatch[1])) {
        const literal = pureStringLiteral(element)
        if (literal != null) literals.push(literal)
      }
    }

    // MV2 tabs.executeScript / tabs.insertCSS, `file: "..."` singular.
    const fileRe = /["']?file["']?\s*:\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g
    let fileMatch: RegExpExecArray | null
    while ((fileMatch = fileRe.exec(args))) {
      literals.push(unescapeStringBody(fileMatch[2]))
    }
  }

  return literals
}

/**
 * Extract string-literal URLs the code loads at runtime through same-origin
 * request APIs: fetch(), XMLHttpRequest#open(method, url), and
 * new URL(url, <own-location base>). Computed arguments cannot be traced
 * statically and are skipped.
 */
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

/**
 * Reduce a same-origin URL literal to a filesystem-joinable path (query and
 * hash stripped), or null for remote/other-scheme references.
 */
function fetchLiteralToFsPath(literal: string): string | null {
  const trimmed = literal.trim()
  if (!trimmed) return null
  if (/^[a-zA-Z][\w+.-]*:/.test(trimmed)) return null
  if (trimmed.startsWith('//')) return null
  const noQuery = trimmed.split(/[?#]/)[0]
  return noQuery ? unixify(noQuery) : null
}

/**
 * Blank out // and /* *\/ comments (string-aware) so commented-out calls do
 * not produce copies or missing-file warnings. Contents are replaced with
 * spaces to keep offsets stable.
 */
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

/**
 * Given the index of an opening paren, return the argument text up to the
 * matching close paren (string-aware), or null when unbalanced. No size cap:
 * minifiers hoist completion callbacks into the call's own argument list, so
 * the args of an executeScript call can legitimately span many kilobytes
 * (a ~5KB template literal in the callback used to silently disable tracing
 * for the whole file). Valid JS always balances, so the scan stops at the
 * real closing paren.
 */
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

/**
 * Return the index of the closing quote (string-aware skip). Template
 * literals skip over their `${...}` interpolations, which may nest strings
 * and further templates, without this, the inner backtick of a nested
 * template ends the scan early and every scanner downstream desyncs.
 */
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

/**
 * Given the index just past `${`, return the index of the matching `}` (or
 * cap), skipping nested strings, templates, and object literals.
 */
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

/** Split argument text on top-level commas, tracking nesting and strings. */
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

/**
 * Return the string value when the whole argument is a single static string
 * literal; null for identifiers, concatenations, and template interpolation.
 */
function pureStringLiteral(arg: string): string | null {
  const match = /^\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*$/.exec(arg)
  if (!match) return null
  if (match[1] === '`' && match[2].includes('${')) return null
  return unescapeStringBody(match[2])
}

function unescapeStringBody(body: string): string {
  return body.replace(/\\(.)/g, '$1')
}
