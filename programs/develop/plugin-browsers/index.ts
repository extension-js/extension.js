// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {EventEmitter} from 'node:events'
import type {Compiler} from '@rspack/core'
import {getCanonicalContentScriptEntryName} from '../plugin-web-extension/feature-scripts/contracts'

export type ReloadType = 'full' | 'service-worker' | 'content-scripts'

export interface ReloadInstruction {
  type: ReloadType
  changedContentScriptEntries?: string[]
  changedAssets?: string[]
}

/**
 * Pure reload classifier shared by the launched-browser path (BrowsersPlugin,
 * below) and the controller-less path (the dev server's `--no-browser` reload
 * broadcast). Centralizing the decision keeps both paths converged: the same
 * change always resolves to the same {@link ReloadType}, whether it is handed
 * to the CDP controller or broadcast over the control bridge.
 *
 * `getContentScriptCount` is a thunk so the (cheap) manifest read only happens
 * when classification actually reaches the content-scripts branch.
 *
 * Returns `undefined` for page-only edits (popup/options/devtools/newtab HTML/
 * CSS/JS) — those are delivered by rspack-dev-server's livereload broadcast, so
 * firing an extension reload would race it and flash the open surface.
 */
export function classifyReloadFromSources(opts: {
  changedSources: string[]
  forcedFull?: boolean
  getContentScriptCount: () => number
}): ReloadInstruction | undefined {
  const {changedSources, forcedFull, getContentScriptCount} = opts
  if (changedSources.length === 0) return undefined

  if (forcedFull) {
    return {type: 'full', changedAssets: changedSources}
  }

  const isServiceWorkerSource = (rel: string) =>
    /(^|\/)background(\.|\/)/i.test(rel) || /service[-_.]?worker/i.test(rel)

  if (changedSources.some(isServiceWorkerSource)) {
    return {type: 'service-worker', changedAssets: changedSources}
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
      changedAssets: changedSources
    }
  }

  return undefined
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
  source?: string
  watchSource?: boolean
  sourceFormat?: 'pretty' | 'json' | 'ndjson'
  sourceSummary?: boolean
  sourceMeta?: boolean
  sourceProbe?: string[]
  sourceTree?: 'off' | 'root-only'
  sourceConsole?: boolean
  sourceDom?: boolean
  sourceMaxBytes?: number
  sourceRedact?: 'off' | 'safe' | 'strict'
  sourceIncludeShadow?: 'off' | 'open-only' | 'all'
  sourceDiff?: boolean
  logLevel?: string
  logContexts?: string[]
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: number | string
}

export interface BrowserController {
  reload(instruction?: ReloadInstruction): Promise<void>
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

  constructor(private readonly options: BrowsersPluginOptions) {}

  apply(compiler: Compiler) {
    let pendingReloadReason: ReloadType | undefined
    let pendingChangedSources: string[] = []

    compiler.hooks.watchRun.tap(BrowsersPlugin.name, () => {
      pendingReloadReason = undefined
      pendingChangedSources = []
      const modifiedFiles = compiler.modifiedFiles
      if (!modifiedFiles || modifiedFiles.size === 0) return

      const contextDir = compiler.options.context || ''
      for (const file of modifiedFiles) {
        const normalized = path.relative(contextDir, file).replace(/\\/g, '/')
        pendingChangedSources.push(normalized)

        if (normalized.includes('manifest.json')) {
          pendingReloadReason = 'full'
        } else if (normalized.includes('_locales/')) {
          pendingReloadReason = 'full'
        }
      }
    })

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
        reloadInstruction = classifyReloadFromSources({
          changedSources: pendingChangedSources,
          forcedFull: Boolean(pendingReloadReason),
          getContentScriptCount: () =>
            readContentScriptCount(compilation, outputPath)
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
      } else if (this.controller && reloadInstruction) {
        // EXTENSION_NO_RELOAD: skip the on-rebuild reload dispatch entirely.
        // The bundler still emits the new dist; the user is responsible for
        // a manual page or extension reload when they want to pick up
        // changes. Mirrors the wrapper-skip in feature-scripts/index.ts so
        // a clean dev-mode dist is produced without any reinjection runtime.
        if (process.env.EXTENSION_NO_RELOAD !== 'true') {
          try {
            await this.controller.reload(reloadInstruction)
          } catch {
            // Reload failures are non-fatal — the browser may have been closed
          }
        }
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
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      const list = manifest?.content_scripts
      if (Array.isArray(list)) return list.length
    }
  } catch {
    // ignore
  }

  return 0
}
