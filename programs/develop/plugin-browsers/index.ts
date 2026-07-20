// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {EventEmitter} from 'node:events'
import type {Compiler} from '@rspack/core'
import {
  buildSourceFeatureIndex,
  classifyReloadFromSources,
  createChangedSourcesTracker,
  dispatchReload,
  type ReloadBroker,
  type ReloadInstruction,
  readContentScriptCount
} from '../plugin-reload'

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
    // already printed by the bundler, losing them shouldn't kill the dev
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
  /** Injected browser launcher, provided by the CLI from programs/extension/browsers/ */
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

    compiler.hooks.done.tapPromise(BrowsersPlugin.name, async (stats) => {
      const compilation = stats.compilation
      const hasErrors = compilation.errors && compilation.errors.length > 0

      if (hasErrors) {
        this.emitter.emit('error', {
          errors: compilation.errors.map((e: Error | string) =>
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
        // the SW producer over the control bridge, the SAME executor as
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
