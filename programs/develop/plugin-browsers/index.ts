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
    // EventEmitter throws ERR_UNHANDLED_ERROR when 'error' has no listener;
    // a default listener keeps compile-failure emits from killing dev.
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
  // Browser-generated CDP Log.entryAdded entries never pass through the
  // extension's console hook; the launcher forwards them here. Chromium-only.
  logSink?: BrowserLogSink
}

/** Browser-generated log entry normalized by the launcher's CDP controller. */
export interface BrowserLogSinkEvent {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  text: string
  source?: string
  url?: string
  lineNumber?: number
  timestamp?: number
}

export type BrowserLogSink = (event: BrowserLogSinkEvent) => void

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
  private logSink: BrowserLogSink | undefined

  constructor(private readonly options: BrowsersPluginOptions) {}

  /**
   * The dev server injects the control-bridge broker so a launched
   * Chromium reloads through the SW producer (the same path as `--no-browser`),
   * not the CDP controller. Called once, before the first compile.
   */
  setReloadBroker(broker: ReloadBroker): void {
    this.reloadBroker = broker
  }

  // The dev server injects a sink that routes browser-generated Log.entryAdded
  // entries into the control-bridge log pipeline. Called once, before first compile.
  setLogSink(sink: BrowserLogSink): void {
    this.logSink = sink
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

      // Classify reload from changed sources, not asset names (every compile
      // emits all assets). Page-only edits stay undefined: livereload covers them.
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
            extensionsToLoad: this.extensionsToLoad,
            logSink: this.logSink
          })

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
        // Launched-browser reload routes to the SW producer over the control
        // bridge, the same executor as `--no-browser`. Honors EXTENSION_NO_RELOAD.
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
