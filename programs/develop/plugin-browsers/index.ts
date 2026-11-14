// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {EventEmitter} from 'node:events'
import type {Compiler} from '@rspack/core'
import {humanLine} from '../dev-server/lifecycle-stream'
import {isEmulatorBrowser, isGeckoBasedBrowser} from '../lib/constants'
import * as messages from '../lib/messages'
import {
  buildSourceFeatureIndex,
  classifyReloadFromSources,
  createChangedSourcesTracker,
  dispatchReload,
  type ReloadBroker,
  type ReloadInstruction,
  readContentScriptCount,
  readContentScriptDigests,
  readBootRegistrations,
  readContentScriptFiles,
  readDevBuild,
  readWebAccessibleResources,
  reloadForNewWebResources,
  reloadForRenamedContentScripts,
  reloadForRewrittenContentScripts
} from '../plugin-reload'
import {isAwaitingMainWorldRestart} from '../plugin-web-extension/feature-scripts/steps/warn-main-world-registration-changed'
import type {DevOptions} from '../types'

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
  // Where a false profile came from, so a refusal can name it.
  profileSource?: 'flag' | 'config'
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
  emulatorViewerUrl?: string
  // Browser-generated CDP Log.entryAdded entries never pass through the
  // extension's console hook; the launcher forwards them here. Chromium-only.
  logSink?: BrowserLogSink
  // Present only when the background names a content script registration:
  // the launcher holds the starting URL on it, bounded by the wait it passes.
  awaitBootRegistrations?: (timeoutMs: number) => Promise<'settled' | 'timeout'>
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

export interface ExtensionLoadRetryResult {
  status: 'loaded' | 'refused' | 'unknown'
  reason?: string
  extensionId?: string
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
  /** The browser's refusal reason for this session, or null when it loaded. */
  getExtensionLoadRefusal?(): string | null
  /** Re-offer the current dist. Only ever called while the session is refused. */
  retryExtensionLoad?(): Promise<ExtensionLoadRetryResult>
  /** Start a suspended background again. Firefox only. */
  wakeBackground?(): Promise<boolean>
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
  private emulatorViewerUrl: string | undefined
  private instanceId: string | undefined
  private readyListener: (() => void) | undefined
  // The refusal text last shown to the operator, so repeats stay quiet.
  private lastReportedRefusal: string | null | undefined
  // The content script files the manifest named when the browser last read
  // it: at launch, or at the last reload of the whole extension.
  private loadedContentScriptFiles: string[] = []
  // The bytes of those files as the browser last read them, by digest.
  private loadedContentScriptDigests: Record<string, string> = {}
  // The files that manifest let a web page load, hashed asset names included.
  private loadedWebResources: string[] = []

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

  // A project that registers nothing gets no hold, so its first page opens
  // exactly when it did before.
  private bootRegistrationsHold(
    compilation: object
  ): Pick<BrowserLaunchOptions, 'awaitBootRegistrations'> {
    const broker = this.reloadBroker

    if (
      !broker?.awaitBootRegistrations ||
      !readBootRegistrations(compilation)
    ) {
      return {}
    }

    return {
      awaitBootRegistrations: (timeoutMs) =>
        broker.awaitBootRegistrations?.(timeoutMs) ?? Promise.resolve('settled')
    }
  }

  setEmulatorViewerUrl(url: string): void {
    this.emulatorViewerUrl = url
  }

  // The session's instance id offsets the browser's debugging port, so two
  // dev sessions started together do not both pick the base port.
  setInstanceId(instanceId: string): void {
    this.instanceId = instanceId
  }

  // The dev server asks to hear when the browser is open with the extension
  // loaded. A session the browser refused says so only once a retry loads it.
  setReadyListener(listener: () => void): void {
    this.readyListener = listener
  }

  private announceReady(): void {
    if (this.controller?.getExtensionLoadRefusal?.()) return

    try {
      this.readyListener?.()
    } catch {
      // Best-effort: a listener must never break the compile loop.
    }
  }

  // The broker calls this for a verb that finds no executor. False until the
  // browser is up, and for any browser that cannot be asked.
  async wakeBackground(): Promise<boolean> {
    try {
      return (await this.controller?.wakeBackground?.()) === true
    } catch {
      return false
    }
  }

  private async retryRefusedExtensionLoad(): Promise<boolean> {
    const controller = this.controller

    if (
      !controller?.retryExtensionLoad ||
      !controller.getExtensionLoadRefusal
    ) {
      return false
    }

    if (!controller.getExtensionLoadRefusal()) return false

    if (this.lastReportedRefusal === undefined) {
      // Seed with the launch-time reason: the operator has already read it.
      this.lastReportedRefusal = controller.getExtensionLoadRefusal()
    }

    let outcome: ExtensionLoadRetryResult

    try {
      outcome = await controller.retryExtensionLoad()
    } catch {
      return false
    }

    if (outcome.status === 'loaded') {
      humanLine(messages.extensionLoadRecovered())

      return true
    }

    // Still refused: report only a reason the operator has not already seen.
    // Repeating the launch-time text on every compile reads as "my fix did
    // nothing" even while the edit that fixes it is still being emitted.
    if (
      outcome.status === 'refused' &&
      outcome.reason &&
      outcome.reason !== this.lastReportedRefusal
    ) {
      this.lastReportedRefusal = outcome.reason
      console.error(messages.extensionLoadStillRefused(outcome.reason))
    }

    return false
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
      const contentScriptFiles = readContentScriptFiles(compilation)
      const contentScriptDigests = readContentScriptDigests(
        compilation,
        contentScriptFiles
      )
      const webResources = readWebAccessibleResources(compilation)

      if (!this.isFirstCompile) {
        const {forcedFull, changedSources: sources} = changedSources.snapshot()
        const classified = classifyReloadFromSources({
          changedSources: sources,
          forcedFull,
          getContentScriptCount: () =>
            readContentScriptCount(compilation, outputPath),
          getSourceFeatureIndex: () =>
            buildSourceFeatureIndex(compilation, contextDir),
          outputPath,
          contextDir
        })
        // Emulated Chromium reads the new file index on every reload and
        // swaps a renamed static content script itself, so only a browser
        // that keeps the manifest it loaded needs the whole extension again.
        reloadInstruction = isEmulatorBrowser(
          this.options.browserOptions.browser
        )
          ? classified
          : reloadForRewrittenContentScripts(
              reloadForNewWebResources(
                reloadForRenamedContentScripts(
                  classified,
                  this.loadedContentScriptFiles,
                  contentScriptFiles
                ),
                this.loadedWebResources,
                webResources
              ),
              this.loadedContentScriptDigests,
              contentScriptDigests,
              {
                refreshInPlace: isGeckoBasedBrowser(
                  this.options.browserOptions.browser
                )
              }
            )
      }

      if (
        this.isFirstCompile ||
        reloadInstruction?.type === 'full' ||
        reloadInstruction?.type === 'service-worker'
      ) {
        this.loadedContentScriptFiles = contentScriptFiles
        this.loadedContentScriptDigests = contentScriptDigests
        this.loadedWebResources = webResources
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
            logSink: this.logSink,
            ...this.bootRegistrationsHold(compilation),
            ...(this.options.browserOptions.instanceId || !this.instanceId
              ? {}
              : {instanceId: this.instanceId}),
            ...(this.emulatorViewerUrl
              ? {emulatorViewerUrl: this.emulatorViewerUrl}
              : {})
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

          this.announceReady()
        } catch (error) {
          // No browser came up, so the next compile must try the launch again.
          if (!this.controller) this.isFirstCompile = true

          const reason = error instanceof Error ? error.message : String(error)
          // Print before emitting: the emitter's default 'error' listener
          // swallows, so this is the only surface the operator ever sees.
          console.error(
            messages.browserLaunchFailed(
              this.options.browserOptions.browser as DevOptions['browser'],
              reason
            )
          )

          this.emitter.emit('error', {errors: [reason]})
        }
      } else if (await this.retryRefusedExtensionLoad()) {
        // The guest was absent until this compile, so there is nothing to
        // reload: it just started from the dist that was written.
        this.loadedContentScriptFiles = contentScriptFiles
        this.loadedContentScriptDigests = contentScriptDigests
        this.loadedWebResources = webResources
        this.announceReady()
      } else if (isAwaitingMainWorldRestart(compiler, compilation)) {
        // The restart this build asked for reloads the extension once with
        // the build that replaces it. Reloading here too starts it twice.
        reloadInstruction = undefined
      } else if (this.reloadBroker) {
        // Launched-browser reload routes to the SW producer over the control
        // bridge, the same executor as `--no-browser`. Honors EXTENSION_NO_RELOAD.
        const delivered = await dispatchReload(reloadInstruction, {
          broker: this.reloadBroker,
          build: readDevBuild(compilation)
        })

        // The open tabs hold these bytes only once a producer took the swap.
        // An edit nobody received is compared, and named, again next compile.
        if (delivered && reloadInstruction?.refreshedStylesheets?.length) {
          this.loadedContentScriptDigests = contentScriptDigests
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
