// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {EventEmitter} from 'node:events'
import type {Compiler} from '@rspack/core'
import {isEmulatorBrowser, isGeckoBasedBrowser} from '../lib/constants'
import * as messages from '../lib/messages'
import {CODES, humanLine, humanWarn} from '../lib/messaging'
import {
  buildSourceFeatureIndex,
  classifyReloadFromSources,
  createChangedSourcesTracker,
  createLoadedContentScripts,
  dispatchReload,
  type ReloadBroker,
  type ReloadInstruction,
  readBootRegistrations,
  readContentScriptCount,
  readDevBuild
} from '../plugin-reload'
import {isAwaitingMainWorldRestart} from '../plugin-web-extension/feature-scripts/steps/warn-main-world-registration-changed'
import type {DevOptions} from '../types'
import {waitAtMost} from './bounded-wait'
import {clearLaunchTimedOut, stampLaunchTimedOut} from './launch-timeout-stamp'
import * as browserMessages from './messages'

// The launcher bounds each step it waits on, the longest at 45 seconds, so a
// launch still out after this is not coming back on its own.
export const BROWSER_LAUNCH_TIMEOUT_MS = 3 * 60_000

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

// The one failure path for every engine: the line unless the launcher printed
// it, then the public event. The launcher stamps the contract before it throws.
export function reportLaunchFailure(
  emitter: BuildEmitter,
  failure: {browser: string; error: unknown}
): void {
  const {error} = failure
  const reason = error instanceof Error ? error.message : String(error)
  const fault = error as {code?: unknown; printed?: unknown} | null

  // Print before emitting: the emitter's default 'error' listener swallows.
  if (fault?.printed !== true) {
    console.error(
      messages.browserLaunchFailed(
        failure.browser as DevOptions['browser'],
        reason,
        fault?.code
      )
    )
  }

  emitter.emit('error', {errors: [reason]})
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
  // Present on a plugin that says when its launcher came back, which is what
  // lets a held ready contract stop waiting for launch stamps.
  setLaunchSettledListener?(listener: () => void): void
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
 * function. On later ones it asks plugin-reload what the edit must reload and,
 * once the browser is up with the extension loaded, has it sent.
 *
 * A `BuildEmitter` is exposed as `plugin.emitter`, which extensionDev returns,
 * so a programmatic caller can subscribe to build events without rspack.
 */
export class BrowsersPlugin implements RunnerPlugin {
  static readonly name = 'plugin-browsers'

  /** EventEmitter for build lifecycle events (compiled, error, close). */
  readonly emitter = new BuildEmitter()

  /**
   * Every unpacked folder the browser loads, the user's dist and companions.
   * rspack-config.ts sets it before the first compile.
   */
  extensionsToLoad: string[] = []

  private isFirstCompile = true
  // Set while a launch the hook stopped waiting for still runs, so a rebuild
  // never opens a second browser beside it.
  private launchStillRunning = false
  private controller: BrowserController | undefined
  private reloadBroker: ReloadBroker | undefined
  private logSink: BrowserLogSink | undefined
  private emulatorViewerUrl: string | undefined
  private instanceId: string | undefined
  private readyListener: (() => void) | undefined
  private launchSettledListener: (() => void) | undefined
  // The refusal text last shown to the operator, so repeats stay quiet.
  private lastReportedRefusal: string | null | undefined
  // What the browser last read through the manifest, kept by plugin-reload.
  // It outlives a dev server restart, which applies this plugin again.
  private readonly loadedContentScripts:
    | ReturnType<typeof createLoadedContentScripts>
    | undefined

  constructor(private readonly options: BrowsersPluginOptions) {
    const browser = options.browserOptions.browser

    // Emulated Chromium reads the new file index on every reload and swaps a
    // renamed static content script itself, so nothing is compared for it.
    this.loadedContentScripts = isEmulatorBrowser(browser)
      ? undefined
      : createLoadedContentScripts({
          refreshInPlace: isGeckoBasedBrowser(browser)
        })
  }

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

  // The dev server asks to hear when the launcher came back, with a browser
  // or without one, so its ready contract stops waiting for launch stamps.
  setLaunchSettledListener(listener: () => void): void {
    this.launchSettledListener = listener
  }

  private announceLaunchSettled(): void {
    try {
      this.launchSettledListener?.()
    } catch {
      // Best-effort: a listener must never break the compile loop.
    }
  }

  private announceReady(): void {
    if (this.controller?.getExtensionLoadRefusal?.()) return

    try {
      this.readyListener?.()
    } catch {
      // Best-effort: a listener must never break the compile loop.
    }
  }

  private async launchBrowser(
    compilation: object,
    outputPath: string,
    contextDir: string
  ): Promise<void> {
    const browser = this.options.browserOptions.browser
    const launch = Promise.resolve().then(() =>
      this.options.launcher({
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
    )
    const outcome = await waitAtMost(launch, BROWSER_LAUNCH_TIMEOUT_MS)

    if (outcome.state === 'resolved') {
      this.controller = outcome.value
      await this.enableBrowserLogs()
      this.announceLaunchSettled()
      this.announceReady()

      return
    }

    this.announceLaunchSettled()
    // No browser came up, so the next compile must try the launch again.
    this.isFirstCompile = true

    if (outcome.state === 'rejected') {
      // The launcher stamped the contract itself before it threw.
      reportLaunchFailure(this.emitter, {browser, error: outcome.error})

      return
    }

    // The launcher never came back to stamp anything, so the stamp is ours.
    const reason = browserMessages.browserLaunchTimedOut(
      BROWSER_LAUNCH_TIMEOUT_MS
    )
    stampLaunchTimedOut(outputPath, reason)
    reportLaunchFailure(this.emitter, {
      browser,
      error: Object.assign(new Error(reason), {
        code: CODES.E_BROWSER_START_TIMEOUT
      })
    })

    this.launchStillRunning = true
    launch.then(
      async (controller) => {
        this.launchStillRunning = false
        this.controller = controller
        this.isFirstCompile = false
        clearLaunchTimedOut(outputPath)
        await this.enableBrowserLogs()
        this.announceReady()
      },
      (error: unknown) => {
        this.launchStillRunning = false
        reportLaunchFailure(this.emitter, {browser, error})
      }
    )
  }

  // The browser is already up with the extension, so a capture that fails is
  // a warning on a session that still goes ready, never a failed launch.
  private async enableBrowserLogs(): Promise<void> {
    const browserOptions = this.options.browserOptions
    const logLevel = browserOptions.logLevel || 'off'

    if (logLevel === 'off' || !this.controller) return

    const outcome = await waitAtMost(
      Promise.resolve().then(() =>
        this.controller?.enableUnifiedLogging({
          level: logLevel,
          contexts: browserOptions.logContexts,
          format: browserOptions.logFormat,
          timestamps: browserOptions.logTimestamps,
          color: browserOptions.logColor,
          urlFilter: browserOptions.logUrl,
          tabFilter: browserOptions.logTab
        })
      ),
      BROWSER_LAUNCH_TIMEOUT_MS
    )

    if (outcome.state === 'resolved') return

    const error =
      outcome.state === 'rejected'
        ? outcome.error
        : Object.assign(
            new Error(
              browserMessages.browserLogCaptureTimedOut(
                BROWSER_LAUNCH_TIMEOUT_MS
              )
            ),
            {code: CODES.E_CDP_TIMEOUT}
          )

    // A rejection was stamped by the launcher. A capture that never answered
    // is only warned about, as nothing came back to stamp it.
    humanWarn(
      browserMessages.browserLogCaptureFailed(
        browserOptions.browser,
        error instanceof Error ? error.message : String(error)
      )
    )
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

      // What must reload is plugin-reload's answer, from the sources that
      // changed. The first compile is the build the browser loads.
      let reloadInstruction: ReloadInstruction | undefined

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
        reloadInstruction = this.loadedContentScripts
          ? this.loadedContentScripts.resolve(compilation, classified)
          : classified
      }

      const wasFirstCompile = this.isFirstCompile
      this.isFirstCompile = false

      if (wasFirstCompile) {
        // The launch loads this build. A launch that fails runs again on the
        // next compile, which is then the build the browser reads.
        this.loadedContentScripts?.noteLoaded(compilation)

        if (this.launchStillRunning) {
          this.isFirstCompile = true
        } else {
          await this.launchBrowser(compilation, outputPath, contextDir)
        }
      } else if (await this.retryRefusedExtensionLoad()) {
        // The guest was absent until this compile, so there is nothing to
        // reload: it just started from the dist that was written.
        this.loadedContentScripts?.noteLoaded(compilation)
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

        this.loadedContentScripts?.settle(delivered)
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
