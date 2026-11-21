// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {EventEmitter} from 'node:events'
import type {Compilation, Compiler} from '@rspack/core'
import * as messages from '../lib/messages'
import {CODES, humanLine, humanWarn} from '../lib/messaging'
import {
  createReloadSession,
  type ReloadBroker,
  type ReloadInstruction,
  type ReloadPlan,
  type ReloadSession
} from '../plugin-reload'
import type {BrowserType} from '../types'
import {waitAtMost} from './bounded-wait'
import {
  clearLaunchTimedOut,
  stampLaunchTimedOut,
  stampLogCaptureTimedOut
} from './launch-timeout-stamp'
import * as browserMessages from './messages'

// The launcher bounds each step it waits on, the longest at 45 seconds, so a
// launch still out after this is not coming back on its own.
export const BROWSER_LAUNCH_TIMEOUT_MS = 3 * 60_000

// A retry or a wake is one request to a browser that is already up, so one
// still out after a minute is not coming back on its own.
export const BROWSER_REQUEST_TIMEOUT_MS = 60_000

export interface CompiledEvent {
  outputPath: string
  contextDir: string
  isFirstCompile: boolean
  reloadInstruction?: ReloadInstruction
  extensionsToLoad?: string[]
}

export interface BuildErrorEvent {
  errors: string[]
  /** The launcher's error code on a launch failure, such as `E_BROWSER_START_TIMEOUT`. */
  code?: string
}

export interface BuildEventMap {
  compiled: [CompiledEvent]
  error: [BuildErrorEvent]
}

export class BuildEmitter extends EventEmitter<BuildEventMap> {
  constructor() {
    super()
    // EventEmitter throws ERR_UNHANDLED_ERROR when 'error' has no listener,
    // so a default listener keeps compile-failure emits from killing dev.
    this.on('error', () => {})
  }
}

// The one failure path for every engine: the line unless the launcher printed
// it, then the public event. The launcher stamps the contract before it throws.
export function reportLaunchFailure(
  emitter: BuildEmitter,
  failure: {browser: BrowserType; error: unknown}
): void {
  const {error} = failure
  const reason = error instanceof Error ? error.message : String(error)
  const fault = error as {code?: unknown; printed?: unknown} | null

  // Print before emitting: the emitter's default 'error' listener swallows.
  if (fault?.printed !== true) {
    console.error(
      messages.browserLaunchFailed(failure.browser, reason, fault?.code)
    )
  }

  emitter.emit(
    'error',
    typeof fault?.code === 'string'
      ? {errors: [reason], code: fault.code}
      : {errors: [reason]}
  )
}

export interface BrowserLaunchOptions {
  browser: BrowserType
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
  // extension's console hook, so the launcher forwards them here. Chromium-only.
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

type BrowserLogSink = (event: BrowserLogSinkEvent) => void

// The dev server's answer to whether a MAIN world restart replaces this build,
// handed in so the browser plugins never read session restart state.
export type RestartHold = (compiler: object, compilation?: object) => boolean

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

interface BrowsersPluginOptions {
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

  /** EventEmitter for build lifecycle events (compiled, error). */
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
  // The bounded wait on the launch that is running, held by the next build.
  private launchHeld: Promise<void> | null = null
  private controller: BrowserController | undefined
  private logSink: BrowserLogSink | undefined
  private emulatorViewerUrl: string | undefined
  private instanceId: string | undefined
  private readyListener: (() => void) | undefined
  private launchSettledListener: (() => void) | undefined
  // The refusal text last shown to the operator, so repeats stay quiet.
  private lastReportedRefusal: string | null | undefined
  // The last reason a retry could not be asked, so a save loop says it once.
  private lastRetryFailure: string | undefined
  // Set while a retry the hook stopped waiting for still runs, so a rebuild
  // never asks a second time beside it.
  private retryStillRunning = false
  // The newest build that compiled, which a retry answered late loads.
  private lastBuild: Compilation | undefined
  // What reloads and when, kept by plugin-reload. It outlives a dev server
  // restart, which applies this plugin again.
  private readonly reloads: ReloadSession

  constructor(private readonly options: BrowsersPluginOptions) {
    this.reloads = createReloadSession({
      browser: options.browserOptions.browser
    })
  }

  /**
   * The dev server injects the control-bridge broker so a launched
   * Chromium reloads through the SW producer (the same path as `--no-browser`),
   * not the CDP controller. Called once, before the first compile.
   */
  setReloadBroker(broker: ReloadBroker): void {
    this.reloads.connect(broker)
  }

  // The dev server says which builds a MAIN world restart replaces. Called
  // once, before the first compile.
  setRestartHold(isHeld: RestartHold): void {
    this.reloads.hold(isHeld)
  }

  // The dev server injects a sink that routes browser-generated Log.entryAdded
  // entries into the control-bridge log pipeline. Called once, before first compile.
  setLogSink(sink: BrowserLogSink): void {
    this.logSink = sink
  }

  // A project that registers nothing gets no hold, so its first page opens
  // without waiting.
  private bootRegistrationsHold(
    compilation: object
  ): Pick<BrowserLaunchOptions, 'awaitBootRegistrations'> {
    const awaitBootRegistrations =
      this.reloads.bootRegistrationsWait(compilation)

    return awaitBootRegistrations ? {awaitBootRegistrations} : {}
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

  // True when a browser came up with this build. A launch that failed or is
  // still out reports on 'error', and the build is not reported compiled.
  private async launchBrowser(
    compilation: object,
    outputPath: string,
    contextDir: string
  ): Promise<boolean> {
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
      await this.enableBrowserLogs(outputPath)
      this.announceLaunchSettled()
      this.announceReady()

      return true
    }

    this.announceLaunchSettled()
    // No browser came up, so the next compile must try the launch again.
    this.isFirstCompile = true

    if (outcome.state === 'rejected') {
      // The launcher stamped the contract itself before it threw.
      reportLaunchFailure(this.emitter, {browser, error: outcome.error})

      return false
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
        await this.enableBrowserLogs(outputPath)
        this.announceReady()
        this.emitCompiled({
          outputPath,
          contextDir,
          isFirstCompile: true,
          extensionsToLoad: this.extensionsToLoad
        })
      },
      (error: unknown) => {
        this.launchStillRunning = false
        reportLaunchFailure(this.emitter, {browser, error})
      }
    )

    return false
  }

  private launchNoLongerHeld(held: Promise<void>): void {
    if (this.launchHeld === held) this.launchHeld = null
  }

  private emitCompiled(event: CompiledEvent): void {
    this.emitter.emit('compiled', event)
  }

  // The browser is already up with the extension, so a capture that fails is
  // a warning on a session that still goes ready, never a failed launch.
  private async enableBrowserLogs(outputPath: string): Promise<void> {
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
    // left nothing to stamp it, so the stamp is ours.
    if (outcome.state === 'timeout') {
      stampLogCaptureTimedOut(outputPath, (error as Error).message)
    }

    humanWarn(
      browserMessages.browserLogCaptureFailed(
        browserOptions.browser,
        error instanceof Error ? error.message : String(error)
      )
    )
  }

  // The broker calls this for a verb that finds no executor. False until the
  // browser is up, for any browser that cannot be asked, and past the bound.
  async wakeBackground(): Promise<boolean> {
    const outcome = await waitAtMost(
      Promise.resolve().then(() => this.controller?.wakeBackground?.()),
      BROWSER_REQUEST_TIMEOUT_MS
    )

    return outcome.state === 'resolved' && outcome.value === true
  }

  // Said once per reason, so a save loop does not repeat it.
  private warnRetryFailed(reason: string): void {
    if (reason === this.lastRetryFailure) return

    this.lastRetryFailure = reason
    humanWarn(
      browserMessages.extensionLoadRetryFailed(
        this.options.browserOptions.browser,
        reason
      )
    )
  }

  // True when the browser took the extension on this ask.
  private retryAnswered(outcome: ExtensionLoadRetryResult): boolean {
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

  // The guest was absent until this ask, so there is nothing to reload: it
  // just started from the dist that was written.
  private extensionLoadedOnRetry(compilation: Compilation): void {
    this.reloads.loaded(compilation)
    this.announceReady()
  }

  private async retryRefusedExtensionLoad(
    compilation: Compilation
  ): Promise<boolean> {
    const controller = this.controller

    if (
      !controller?.retryExtensionLoad ||
      !controller.getExtensionLoadRefusal
    ) {
      return false
    }

    if (!controller.getExtensionLoadRefusal()) return false
    if (this.retryStillRunning) return false

    if (this.lastReportedRefusal === undefined) {
      // Seed with the launch-time reason: the operator has already read it.
      this.lastReportedRefusal = controller.getExtensionLoadRefusal()
    }

    const retry = Promise.resolve().then(() =>
      controller.retryExtensionLoad?.()
    )
    const outcome = await waitAtMost(retry, BROWSER_REQUEST_TIMEOUT_MS)

    if (outcome.state === 'rejected') {
      const {error} = outcome
      this.warnRetryFailed(
        error instanceof Error ? error.message : String(error)
      )

      return false
    }

    if (outcome.state === 'resolved') {
      return outcome.value ? this.retryAnswered(outcome.value) : false
    }

    this.warnRetryFailed(
      browserMessages.extensionLoadRetryTimedOut(BROWSER_REQUEST_TIMEOUT_MS)
    )

    this.retryStillRunning = true
    retry.then(
      (late) => {
        this.retryStillRunning = false

        if (late && this.retryAnswered(late)) {
          this.extensionLoadedOnRetry(this.lastBuild || compilation)
        }
      },
      () => {
        this.retryStillRunning = false
      }
    )

    return false
  }

  apply(compiler: Compiler) {
    const builds = this.reloads.watch(compiler)

    // The browser reads the dist as it starts, and a done hook that is still
    // out does not keep the bundler from starting a build, so it waits here.
    compiler.hooks.watchRun.tapPromise(BrowsersPlugin.name, async () => {
      if (this.launchHeld) await this.launchHeld
    })

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

      this.lastBuild = compilation

      // What must reload is plugin-reload's answer, held while a restart
      // replaces this build. The first compile is the build the browser loads.
      const plan: ReloadPlan = this.isFirstCompile
        ? {held: false}
        : builds.plan(compilation)
      const reloadInstruction = plan.instruction

      const wasFirstCompile = this.isFirstCompile
      this.isFirstCompile = false

      if (wasFirstCompile) {
        // The launch loads this build. A launch that fails runs again on the
        // next compile, which is then the build the browser reads.
        this.reloads.loaded(compilation)

        if (this.launchStillRunning) {
          this.isFirstCompile = true

          return
        }

        const launch = this.launchBrowser(compilation, outputPath, contextDir)
        const held: Promise<void> = launch.then(
          () => this.launchNoLongerHeld(held),
          () => this.launchNoLongerHeld(held)
        )

        this.launchHeld = held

        if (!(await launch)) return
      } else if (await this.retryRefusedExtensionLoad(compilation)) {
        this.extensionLoadedOnRetry(compilation)
      } else if (!plan.held) {
        // Launched-browser reload routes to the SW producer over the control
        // bridge, the same executor as `--no-browser`. Honors EXTENSION_NO_RELOAD.
        await this.reloads.deliver(reloadInstruction, compilation)
      }

      this.emitCompiled({
        outputPath,
        contextDir,
        isFirstCompile: wasFirstCompile,
        reloadInstruction,
        extensionsToLoad: wasFirstCompile ? this.extensionsToLoad : undefined
      })
    })
  }
}
