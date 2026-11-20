// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler} from '@rspack/core'
import {CODES} from '../lib/messaging'
import {
  createReloadSession,
  type ReloadBroker,
  type ReloadInstruction
} from '../plugin-reload'
import type {SafariPackagerFn} from '../types'
import {waitAtMost} from './bounded-wait'
import {
  BuildEmitter,
  type RestartHold,
  type RunnerPlugin,
  reportLaunchFailure
} from './index'
import {clearLaunchTimedOut, stampLaunchTimedOut} from './launch-timeout-stamp'
import * as browserMessages from './messages'

// A cold xcodebuild takes minutes and the guided enable waits on the user, so
// the first package gets a long bound. Only a hung tool reaches it.
export const SAFARI_FIRST_PACKAGE_TIMEOUT_MS = 10 * 60_000

// A resync is xcodebuild alone, with no step that waits on the user.
export const SAFARI_RESYNC_TIMEOUT_MS = 5 * 60_000

// Safari reloads through the same control bridge every other engine uses, and
// the dev server runs the bundler in watch mode. This plugin rides that watch
// loop: the first successful compile blocks for the full package (convert >
// xcodebuild > open > guided enable), and every later compile blocks for its
// resync, so no build writes into the dist xcodebuild is reading. Each wait is
// bounded, and builds that end while a package still runs collapse into one
// follow-up against the newest output.
type SafariPackageTarget = {
  outputPath: string
  contextDir: string
  instruction?: ReloadInstruction
}

export class SafariDevPlugin implements RunnerPlugin {
  static readonly name = 'safari-dev'

  readonly emitter = new BuildEmitter()
  extensionsToLoad: string[] = []

  private firstRun = true
  // Set while a first package the hook stopped waiting for still runs, so a
  // rebuild queues behind it instead of starting a second one.
  private firstPackageStillRunning = false
  private active = false
  private pending: SafariPackageTarget | null = null
  private readyListener: (() => void) | undefined
  // Safari takes the same granularity as Chromium. A content-script
  // reinjection was measured working there, same tab, through the producer's
  // executeScript path. The package restarts the extension, so the session
  // keeps only the part a restart cannot deliver.
  private readonly reloads = createReloadSession({
    browser: 'safari',
    packaged: true
  })

  constructor(private readonly packager: SafariPackagerFn) {}

  // Duck-typed by the dev server, the same seam the launched-browser plugin has.
  setReloadBroker(broker: ReloadBroker): void {
    this.reloads.connect(broker)
  }

  // The same restart check the launched-browser plugin is handed.
  setRestartHold(isHeld: RestartHold): void {
    this.reloads.hold(isHeld)
  }


  // Safari is ready when its first full package pass finished.
  setReadyListener(listener: () => void): void {
    this.readyListener = listener
  }

  apply(compiler: Compiler) {
    const builds = this.reloads.watch(compiler)

    compiler.hooks.done.tapPromise(SafariDevPlugin.name, async (stats) => {
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

      // Classify from changed sources, like the launched-browser path. The
      // first package has nothing to reload, it is the state the browser loads.
      const plan = this.firstRun ? undefined : builds.plan(compilation)

      // The package is itself a reload, so a build a restart replaces is not
      // packaged. The restart's own build is.
      if (plan?.held) {
        this.emitter.emit('compiled', {
          outputPath,
          contextDir,
          isFirstCompile: false
        })

        return
      }

      const instruction = plan?.instruction

      const target: SafariPackageTarget = {
        outputPath,
        contextDir,
        instruction
      }

      if (this.firstRun && this.firstPackageStillRunning) {
        this.pending = target

        return
      }

      // First compile blocks the hook so the app opens and the guided-enable
      // step finishes before the dev server reports ready, unchanged UX.
      if (this.firstRun) {
        await this.runFirst(target)

        return
      }

      // A resync is already running: keep only the newest output and let the
      // active run pick it up when it finishes, so a save burst is one rebuild.
      if (this.active) {
        this.pending = {
          ...target,
          instruction: this.reloads.combine(
            this.pending?.instruction,
            target.instruction
          )
        }

        return
      }

      await this.resync(target)
    })
  }

  // Waits on its own package only. A follow-up queued behind it runs on,
  // and a run past the bound keeps going while the hook returns.
  private async resync(target: SafariPackageTarget) {
    this.active = true
    const run = this.runResync(target)
    const outcome = await waitAtMost(run, SAFARI_RESYNC_TIMEOUT_MS)

    if (outcome.state !== 'timeout') {
      this.resyncFinished()

      return
    }

    this.reportFailure(
      'resync',
      new Error(browserMessages.safariPackageTimedOut(SAFARI_RESYNC_TIMEOUT_MS))
    )

    void run.then(() => this.resyncFinished())
  }

  // Collapse everything queued during the run into one follow-up.
  private resyncFinished() {
    const next = this.pending
    this.pending = null

    if (next) {
      void this.resync(next)

      return
    }

    this.active = false
  }

  private async runFirst(target: SafariPackageTarget) {
    const run = Promise.resolve().then(() =>
      this.packager(target.outputPath, 'full')
    )
    const outcome = await waitAtMost(run, SAFARI_FIRST_PACKAGE_TIMEOUT_MS)

    if (outcome.state === 'resolved') {
      await this.afterPackage(target, 'full')

      return
    }

    // A failed first package keeps firstRun true, so the next compile retries.
    if (outcome.state === 'rejected') {
      this.reportFailure('full', outcome.error)

      return
    }

    // The packager never came back to stamp anything, so the stamp is ours.
    const reason = browserMessages.safariPackageTimedOut(
      SAFARI_FIRST_PACKAGE_TIMEOUT_MS
    )
    stampLaunchTimedOut(target.outputPath, reason)
    this.reportFailure(
      'full',
      Object.assign(new Error(reason), {code: CODES.E_BROWSER_START_TIMEOUT})
    )

    this.firstPackageStillRunning = true
    run.then(
      async () => {
        this.firstPackageStillRunning = false
        clearLaunchTimedOut(target.outputPath)
        await this.afterPackage(target, 'full')
        this.drainQueuedSave()
      },
      (error: unknown) => {
        this.firstPackageStillRunning = false
        this.pending = null
        this.reportFailure('full', error)
      }
    )
  }

  // A save that waited on a late first package is packaged now, as a resync.
  private drainQueuedSave() {
    const next = this.pending
    if (!next || this.active) return

    this.pending = null
    void this.resync(next)
  }

  private async runResync(target: SafariPackageTarget) {
    try {
      await this.packager(target.outputPath, 'resync')
    } catch (error) {
      // A failed resync still drains pending.
      this.reportFailure('resync', error)

      return
    }

    await this.afterPackage(target, 'resync')
  }

  private async afterPackage(
    target: SafariPackageTarget,
    mode: 'full' | 'resync'
  ) {
    const wasFirstRun = mode === 'full'

    if (wasFirstRun) {
      this.firstRun = false

      try {
        this.readyListener?.()
      } catch {
        // Best-effort: a listener must never break the package loop.
      }
    }

    // Only after the package succeeded: the appex Safari reads is replaced by
    // xcodebuild, so a signal sent earlier would reload the previous bytes.
    // The rebuilt appex is itself the reload, with or without an instruction.
    if (!wasFirstRun) await this.reloads.deliver(target.instruction)

    this.emitter.emit('compiled', {
      outputPath: target.outputPath,
      contextDir: target.contextDir,
      isFirstCompile: wasFirstRun,
      ...(target.instruction ? {reloadInstruction: target.instruction} : {})
    })
  }

  // A first package that failed takes the launch failure path, and the
  // packager has stamped the contract. A resync leaves the previous build up.
  private reportFailure(mode: 'full' | 'resync', error: unknown) {
    if (mode === 'full') {
      reportLaunchFailure(this.emitter, {browser: 'safari', error})

      return
    }

    const reason = error instanceof Error ? error.message : String(error)

    if ((error as {printed?: unknown} | null)?.printed !== true) {
      console.error(browserMessages.safariResyncFailed(reason))
    }

    this.emitter.emit('error', {errors: [reason]})
  }
}
