// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler} from '@rspack/core'
import {BuildEmitter, type RunnerPlugin} from './index'

export type SafariPackagerFn = (
  distPath: string,
  mode: 'full' | 'resync'
) => Promise<void>

// Safari has no live-reload channel, but the dev server already runs the
// bundler in watch mode. This plugin rides that watch loop: the first
// successful compile blocks for the full package
// (convert > xcodebuild > open > guided enable); every later compile resyncs
// xcodebuild in the background so the bundler loop is never blocked, and a
// burst of saves collapses to a single follow-up against the newest output.
type SafariPackageTarget = {outputPath: string; contextDir: string}

export class SafariDevPlugin implements RunnerPlugin {
  static readonly name = 'safari-dev'

  readonly emitter = new BuildEmitter()
  extensionsToLoad: string[] = []

  private firstRun = true
  private active = false
  private pending: SafariPackageTarget | null = null
  private idleWaiters: Array<() => void> = []

  constructor(private readonly packager: SafariPackagerFn) {}

  apply(compiler: Compiler) {
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

      const target: SafariPackageTarget = {
        outputPath: String(compilation.options?.output?.path || ''),
        contextDir: String(compilation.options?.context || '')
      }

      // First compile blocks the hook so the app opens and the guided-enable
      // step finishes before the dev server reports ready, unchanged UX.
      if (this.firstRun) {
        await this.runOne(target, 'full')
        return
      }

      // A resync is already running: keep only the newest output and let the
      // active run pick it up when it finishes, so a save burst is one rebuild.
      if (this.active) {
        this.pending = target
        return
      }

      this.active = true
      void this.drain(target)
    })
  }

  // Resolves once nothing is packaging or queued. Test hook + a handle for
  // callers that need to wait for the watch loop to settle.
  idle(): Promise<void> {
    if (!this.active && !this.pending) return Promise.resolve()
    return new Promise<void>((resolve) => this.idleWaiters.push(resolve))
  }

  private async drain(target: SafariPackageTarget) {
    try {
      let next: SafariPackageTarget | null = target
      while (next) {
        await this.runOne(next, 'resync')
        // Collapse everything queued during the run into one follow-up.
        next = this.pending
        this.pending = null
      }
    } finally {
      this.active = false
      this.settleIdle()
    }
  }

  private async runOne(target: SafariPackageTarget, mode: 'full' | 'resync') {
    const wasFirstRun = mode === 'full'
    try {
      await this.packager(target.outputPath, mode)
    } catch (error) {
      // Never swallow. On a failed first package keep firstRun true so the next
      // compile retries the full flow; a failed resync still drains pending.
      this.emitter.emit('error', {
        errors: [error instanceof Error ? error.message : String(error)]
      })
      return
    }

    if (wasFirstRun) this.firstRun = false

    this.emitter.emit('compiled', {
      outputPath: target.outputPath,
      contextDir: target.contextDir,
      isFirstCompile: wasFirstRun
    })
  }

  private settleIdle() {
    if (this.active || this.pending) return
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const resolve of waiters) resolve()
  }
}
