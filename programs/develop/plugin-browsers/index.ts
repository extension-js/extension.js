// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {EventEmitter} from 'node:events'
import type {Compiler} from '@rspack/core'
import * as fs from 'fs'
import * as path from 'path'
import {getCanonicalContentScriptEntryName} from '../plugin-web-extension/feature-scripts/contracts'
import {stripBom} from '../lib/parse-json-safe'
import {
  createChangedSourcesTracker,
  dispatchReload,
  type ReloadBroker
} from './reload-dispatch'

export {
  type ChangedSourcesSnapshot,
  type ChangedSourcesTracker,
  createChangedSourcesTracker,
  dispatchReload,
  type ReloadBroker,
  type ReloadExecutor
} from './reload-dispatch'

export type ReloadType = 'full' | 'service-worker' | 'content-scripts'

export interface ReloadInstruction {
  /**
   * 'page' is a notify-only instruction: the extension itself is NOT reloaded
   * (rspack-dev-server's livereload refreshes the open surface), but the
   * signal still travels the bridge so every "Reloading…" surface (stdout,
   * devtools pill) reflects it.
   */
  type: ReloadType | 'page'
  changedContentScriptEntries?: string[]
  changedAssets?: string[]
  /**
   * Human context label shared VERBATIM by every surface that announces this
   * reload — CLI stdout, the page's devtools console line, and the devtools
   * extension pill — so they can never disagree about what is reloading.
   * e.g. "content_script (content/scripts.tsx)".
   */
  label?: string
}

/** "context (fileA, fileB +2 more)" — the one label every reload surface shows. */
export function formatReloadContextLabel(
  context: string,
  files: string[]
): string {
  if (!files.length) return context
  const shown = files.slice(0, 2).join(', ')
  const extra = files.length > 2 ? ` +${files.length - 2} more` : ''
  return `${context} (${shown}${extra})`
}

/**
 * Best-effort page-context name for a page-only edit, mirroring the path
 * heuristics used for the service-worker branch. Only used for the label —
 * never for the reload decision.
 */
export function pageContextFromSources(changedSources: string[]): string {
  const rules: Array<[RegExp, string]> = [
    [/(^|\/)(sidebar|side[-_]?panel)(\.|\/)/i, 'sidebar page'],
    [/(^|\/)(action|popup)(\.|\/)/i, 'popup page'],
    [/(^|\/)options(\.|\/)/i, 'options page'],
    [/(^|\/)devtools(\.|\/)/i, 'devtools page'],
    [/(^|\/)(newtab|new[-_]?tab)(\.|\/)/i, 'new tab page'],
    [/(^|\/)(history|bookmarks)(\.|\/)/i, 'page']
  ]
  for (const rel of changedSources) {
    for (const [re, name] of rules) {
      if (re.test(rel)) return name
    }
  }
  return 'page'
}

/**
 * Which dev-reload feature owns each project source file, derived from the
 * compilation's chunk graph. Name-pattern heuristics are NOT trustworthy for
 * this decision: a service worker named `background-ultimate.js` fails the
 * `background.`/`service-worker` patterns and would be re-injected as a
 * content script (the SW then never restarts — the wild-corpus anshul bug).
 */
export interface SourceFeatureIndex {
  /** Sources bundled into a background/* chunk (SW or MV2 scripts). */
  swSources: Set<string>
  /** Source → canonical content_scripts entry names whose chunks contain it. */
  contentEntriesBySource: Map<string, Set<string>>
  /** Sources bundled only into page chunks (popup/options/devtools/…). */
  pageSources: Set<string>
}

/** Loader-prefixed module identifier → project-relative resource path(s).
 * Classic-concat entries hide their member files in the
 * `__extensionjs_classic_concat__` resource query — expand those too, since
 * an edit to ANY member recompiles the entry. */
function moduleResourcesFromIdentifier(
  identifier: string,
  contextDir: string
): string[] {
  const afterLoaders = identifier.slice(identifier.lastIndexOf('!') + 1)
  // strip a trailing `|<layer>` marker (rspack appends the module layer)
  const noLayer = afterLoaders.split('|')[0]
  const queryIndex = noLayer.indexOf('?')
  const resourcePath = queryIndex === -1 ? noLayer : noLayer.slice(0, queryIndex)
  const query = queryIndex === -1 ? '' : noLayer.slice(queryIndex)

  const out: string[] = []
  const push = (absolute: string) => {
    if (!absolute || !path.isAbsolute(absolute)) return
    out.push(path.relative(contextDir, absolute).replace(/\\/g, '/'))
  }
  push(resourcePath)

  const concatMatch = query.match(/[?&]__extensionjs_classic_concat__=([^&]+)/)
  if (concatMatch) {
    try {
      const data = JSON.parse(decodeURIComponent(concatMatch[1]))
      for (const file of data?.js || []) push(String(file))
    } catch {
      // malformed query — the first file alone still classifies the entry
    }
  }
  return out
}

/**
 * Walk the finished compilation and record, for every bundled source file,
 * which reload feature its chunks belong to. Nameless (async) chunks are
 * skipped — sources reached only through dynamic imports fall back to the
 * name heuristics in {@link classifyReloadFromSources}.
 */
export function buildSourceFeatureIndex(
  compilation: any,
  contextDir: string
): SourceFeatureIndex {
  const index: SourceFeatureIndex = {
    swSources: new Set(),
    contentEntriesBySource: new Map(),
    pageSources: new Set()
  }
  const chunkGraph = compilation.chunkGraph
  for (const chunk of compilation.chunks || []) {
    const name = String(chunk?.name || '')
    if (!name) continue
    const isBackground = /^background\//.test(name)
    const isContent = /^content_scripts\//.test(name)
    for (const module of chunkGraph.getChunkModulesIterable(chunk)) {
      let identifier = ''
      try {
        identifier = String(module.identifier())
      } catch {
        continue
      }
      for (const rel of moduleResourcesFromIdentifier(identifier, contextDir)) {
        if (isBackground) {
          index.swSources.add(rel)
        } else if (isContent) {
          let entries = index.contentEntriesBySource.get(rel)
          if (!entries) {
            entries = new Set()
            index.contentEntriesBySource.set(rel, entries)
          }
          entries.add(name)
        } else {
          index.pageSources.add(rel)
        }
      }
    }
  }
  return index
}

/**
 * Pure reload classifier shared by the launched-browser path (BrowsersPlugin,
 * below) and the controller-less path (the dev server's `--no-browser` reload
 * broadcast). Centralizing the decision keeps both paths converged: the same
 * change always resolves to the same {@link ReloadType}, whether it is handed
 * to the CDP controller or broadcast over the control bridge.
 *
 * Decision order per changed file:
 *   1. manifest/_locales (forcedFull) → full reload.
 *   2. Chunk-graph membership ({@link buildSourceFeatureIndex}): background
 *      chunk → service-worker; content chunk → content-scripts (re-injecting
 *      ONLY the entries whose chunks contain a changed file); page chunk →
 *      notify-only page.
 *   3. Emitted static asset (exists at the same relative path in the output
 *      dir: manifest icons, web-accessible resources, DNR rulesets) → full
 *      reload — the browser only re-reads those from disk on an extension
 *      reload, and re-injecting content scripts for an icon edit is a storm
 *      of no-ops (the wild-corpus Sappgulf bug).
 *   4. Name heuristics, as before, for anything the graph can't see.
 *
 * The thunks keep the (cheap) index build and manifest read lazy — they only
 * run when a classification actually needs them.
 *
 * Returns a notify-only `type: 'page'` instruction for page-only edits
 * (popup/options/devtools/newtab HTML/CSS/JS) — those are delivered by
 * rspack-dev-server's livereload broadcast, so firing an extension reload
 * would race it and flash the open surface. The 'page' instruction only
 * carries the announcement label; dispatch never reloads the extension for it.
 */
export function classifyReloadFromSources(opts: {
  changedSources: string[]
  forcedFull?: boolean
  getContentScriptCount: () => number
  getSourceFeatureIndex?: () => SourceFeatureIndex | null
  outputPath?: string
}): ReloadInstruction | undefined {
  const {
    changedSources,
    forcedFull,
    getContentScriptCount,
    getSourceFeatureIndex,
    outputPath
  } = opts
  if (changedSources.length === 0) return undefined

  if (forcedFull) {
    return {
      type: 'full',
      changedAssets: changedSources,
      label: formatReloadContextLabel('extension', changedSources)
    }
  }

  let index: SourceFeatureIndex | null = null
  try {
    index = getSourceFeatureIndex ? getSourceFeatureIndex() : null
  } catch {
    index = null
  }

  const swChanged: string[] = []
  const contentEntries = new Set<string>()
  const contentChanged: string[] = []
  const pageChanged: string[] = []
  const unknown: string[] = []
  for (const rel of changedSources) {
    // A source can live in MORE than one chunk family (e.g. a shared module
    // listed in both background.scripts and content_scripts[].js): record
    // every membership, so the instruction below can fan out to both reload
    // paths instead of silently dropping the content half.
    let known = false
    if (index?.swSources.has(rel)) {
      swChanged.push(rel)
      known = true
    }
    if (index?.contentEntriesBySource.has(rel)) {
      contentChanged.push(rel)
      for (const entry of index.contentEntriesBySource.get(rel)!) {
        contentEntries.add(entry)
      }
      known = true
    }
    if (!known && index?.pageSources.has(rel)) {
      pageChanged.push(rel)
      known = true
    }
    if (!known) {
      unknown.push(rel)
    }
  }

  // A changed emitted static asset (icon, web-accessible resource, DNR
  // ruleset…) needs a full extension reload to be re-read from disk.
  const staticAssetChanged =
    outputPath &&
    unknown.some((rel) => {
      try {
        return fs.existsSync(path.join(outputPath, rel))
      } catch {
        return false
      }
    })

  if (swChanged.length > 0) {
    // A shared module (SW chunk + content chunk) needs BOTH paths: the SW
    // restart carries the instruction, and changedContentScriptEntries tells
    // the producer which open-tab content scripts went stale — the restarted
    // producer heals them from the pending-reinject flag it sets pre-reload.
    return {
      type: 'service-worker',
      ...(contentEntries.size > 0
        ? {changedContentScriptEntries: [...contentEntries].sort()}
        : {}),
      changedAssets: changedSources,
      label: formatReloadContextLabel(
        contentEntries.size > 0
          ? 'service_worker + content_script'
          : 'service_worker',
        swChanged
      )
    }
  }

  if (staticAssetChanged) {
    return {
      type: 'full',
      changedAssets: changedSources,
      label: formatReloadContextLabel('extension', changedSources)
    }
  }

  if (contentChanged.length > 0) {
    return {
      type: 'content-scripts',
      changedContentScriptEntries: [...contentEntries].sort(),
      changedAssets: changedSources,
      label: formatReloadContextLabel('content_script', contentChanged)
    }
  }

  if (pageChanged.length > 0 && unknown.length === 0) {
    return {
      type: 'page',
      changedAssets: changedSources,
      label: formatReloadContextLabel(
        pageContextFromSources(pageChanged),
        pageChanged
      )
    }
  }

  // ---- legacy name heuristics: sources the chunk graph can't attribute ----

  const isServiceWorkerSource = (rel: string) =>
    /(^|\/)background(\.|\/)/i.test(rel) || /service[-_.]?worker/i.test(rel)

  if (unknown.some(isServiceWorkerSource)) {
    return {
      type: 'service-worker',
      changedAssets: changedSources,
      label: formatReloadContextLabel('service_worker', changedSources)
    }
  }

  const contentScriptCount = getContentScriptCount()
  if (contentScriptCount > 0) {
    const entries: string[] = []
    for (let i = 0; i < contentScriptCount; i++) {
      entries.push(getCanonicalContentScriptEntryName(i))
    }
    return {
      type: 'content-scripts',
      changedContentScriptEntries: entries,
      changedAssets: changedSources,
      label: formatReloadContextLabel('content_script', changedSources)
    }
  }

  // Page-only edit: livereload owns the actual refresh; emit a notify-only
  // instruction so the reload announcement surfaces still fire.
  return {
    type: 'page',
    changedAssets: changedSources,
    label: formatReloadContextLabel(
      pageContextFromSources(changedSources),
      changedSources
    )
  }
}

export interface CompiledEvent {
  outputPath: string
  contextDir: string
  isFirstCompile: boolean
  reloadInstruction?: ReloadInstruction
  extensionsToLoad?: string[]
}

export interface BuildErrorEvent {
  errors: string[]
}

export interface BuildEventMap {
  compiled: [CompiledEvent]
  error: [BuildErrorEvent]
  close: []
}

export class BuildEmitter extends EventEmitter<BuildEventMap> {
  constructor() {
    super()
    // EventEmitter throws ERR_UNHANDLED_ERROR when 'error' is emitted without
    // a listener. Build errors here are rspack/swc compile failures that are
    // already printed by the bundler — losing them shouldn't kill the dev
    // process and prevent recovery on the next save. Install a default
    // listener so user-installed handlers still fire (EventEmitter delivers
    // to all listeners) while the emit itself is non-throwing.
    this.on('error', () => {})
  }
}

export interface BrowserLaunchOptions {
  browser: string
  outputPath: string
  contextDir: string
  extensionsToLoad: string[]
  mode?: 'development' | 'production'
  enableDevtools?: boolean
  noOpen?: boolean
  profile?: string | false
  persistProfile?: boolean
  keepProfileChanges?: boolean
  copyFromProfile?: string
  preferences?: Record<string, unknown>
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  startingUrl?: string
  chromiumBinary?: string
  geckoBinary?: string
  instanceId?: string
  port?: number | string
  dryRun?: boolean
  logLevel?: string
  logContexts?: string[]
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: number | string
}

export interface BrowserController {
  enableUnifiedLogging(opts: {
    level?: string
    contexts?: string[]
    format?: 'pretty' | 'json' | 'ndjson'
    timestamps?: boolean
    color?: boolean
    urlFilter?: string
    tabFilter?: number | string
  }): Promise<void>
  close(): Promise<void>
}

export type BrowserLauncherFn = (
  opts: BrowserLaunchOptions
) => Promise<BrowserController>

export interface RunnerPlugin {
  readonly emitter: BuildEmitter
  extensionsToLoad: string[]
  apply(compiler: Compiler): void
}

export interface BrowsersPluginOptions {
  /** Injected browser launcher — provided by the CLI from programs/extension/browsers/ */
  launcher: BrowserLauncherFn
  /** Browser-related options forwarded to the launcher (outputPath/contextDir/extensionsToLoad are filled at compile time) */
  browserOptions: Omit<
    BrowserLaunchOptions,
    'outputPath' | 'contextDir' | 'extensionsToLoad'
  >
}

/**
 * BrowsersPlugin
 *
 * An rspack plugin that manages the browser lifecycle for extension development.
 * On first successful compilation it launches a browser via the injected launcher
 * function; on subsequent compilations it classifies changed files and triggers
 * the appropriate reload strategy (full / service-worker / content-scripts).
 *
 * A `BuildEmitter` is exposed as `plugin.emitter` so that external consumers
 * (CLI telemetry, wait-mode, etc.) can subscribe to build events without
 * coupling to rspack.
 */
export class BrowsersPlugin implements RunnerPlugin {
  static readonly name = 'plugin-browsers'

  /** EventEmitter for build lifecycle events (compiled, error, close). */
  readonly emitter = new BuildEmitter()

  /**
   * Extension directories to load alongside the user extension.
   * Set externally by webpack-config after computing companion extensions,
   * before the first compilation.
   */
  extensionsToLoad: string[] = []

  private isFirstCompile = true
  private controller: BrowserController | undefined
  private reloadBroker: ReloadBroker | undefined

  constructor(private readonly options: BrowsersPluginOptions) {}

  /**
   * Option B: the dev server injects the control-bridge broker so a launched
   * Chromium reloads through the SW producer (the same path as `--no-browser`),
   * not the CDP controller. Called once, before the first compile.
   */
  setReloadBroker(broker: ReloadBroker): void {
    this.reloadBroker = broker
  }

  apply(compiler: Compiler) {
    const changedSources = createChangedSourcesTracker(compiler)

    compiler.hooks.done.tapPromise(BrowsersPlugin.name, async (stats: any) => {
      const compilation = stats.compilation
      const hasErrors = compilation.errors && compilation.errors.length > 0

      if (hasErrors) {
        this.emitter.emit('error', {
          errors: compilation.errors.map((e: any) =>
            typeof e === 'string' ? e : e.message || String(e)
          )
        })
        return
      }

      const outputPath = String(compilation.options?.output?.path || '')
      const contextDir = String(compilation.options?.context || '')

      // Classify reload type from modified source files. Asset-name heuristics
      // are unreliable because `compilation.assets` contains every emitted
      // asset on each compile (including a persistent background/service_worker.js),
      // which made every classification resolve to 'service-worker' even when
      // only a content script changed.
      //
      // Page-only edits (popup/options/devtools/newtab HTML/CSS/JS) classify to
      // `undefined`: rspack-dev-server's livereload broadcast already refreshes
      // those open surfaces, so firing chrome.runtime.reload() would race it and
      // flash the surface. See scripts/reload-matrix/scenarios.mjs scenario
      // "popup-html-edit-popup-open" for the ground-truth assertion.
      let reloadInstruction: ReloadInstruction | undefined

      if (!this.isFirstCompile) {
        const {forcedFull, changedSources: sources} = changedSources.snapshot()
        reloadInstruction = classifyReloadFromSources({
          changedSources: sources,
          forcedFull,
          getContentScriptCount: () =>
            readContentScriptCount(compilation, outputPath),
          getSourceFeatureIndex: () =>
            buildSourceFeatureIndex(compilation, contextDir),
          outputPath
        })
      }

      const wasFirstCompile = this.isFirstCompile
      this.isFirstCompile = false

      if (wasFirstCompile) {
        try {
          this.controller = await this.options.launcher({
            ...this.options.browserOptions,
            outputPath,
            contextDir,
            extensionsToLoad: this.extensionsToLoad
          })

          // Enable unified logging when requested
          const logLevel = this.options.browserOptions.logLevel || 'off'
          if (logLevel !== 'off' && this.controller) {
            await this.controller.enableUnifiedLogging({
              level: logLevel,
              contexts: this.options.browserOptions.logContexts,
              format: this.options.browserOptions.logFormat,
              timestamps: this.options.browserOptions.logTimestamps,
              color: this.options.browserOptions.logColor,
              urlFilter: this.options.browserOptions.logUrl,
              tabFilter: this.options.browserOptions.logTab
            })
          }
        } catch (error) {
          this.emitter.emit('error', {
            errors: [error instanceof Error ? error.message : String(error)]
          })
        }
      } else if (this.reloadBroker) {
        // Launched-browser reload through the shared dispatch seam: it routes to
        // the SW producer over the control bridge — the SAME executor as
        // `--no-browser`, for both Chromium and Firefox. The CDP/RDP controller
        // is kept only for logging / source inspection. Honors EXTENSION_NO_RELOAD.
        await dispatchReload(reloadInstruction, {
          broker: this.reloadBroker
        })
      }

      this.emitter.emit('compiled', {
        outputPath,
        contextDir,
        isFirstCompile: wasFirstCompile,
        reloadInstruction,
        extensionsToLoad: wasFirstCompile ? this.extensionsToLoad : undefined
      })
    })
  }
}

export function readContentScriptCount(
  compilation: any,
  outputPath: string
): number {
  try {
    const asset = compilation.getAsset?.('manifest.json')
    if (asset?.source) {
      const manifest = JSON.parse(String(asset.source.source()))
      const list = manifest?.content_scripts
      if (Array.isArray(list)) return list.length
    }
  } catch {
    // fall through to disk read
  }

  try {
    const manifestPath = path.join(outputPath, 'manifest.json')
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(stripBom(fs.readFileSync(manifestPath, 'utf8')))
      const list = manifest?.content_scripts
      if (Array.isArray(list)) return list.length
    }
  } catch {
    // ignore
  }

  return 0
}
