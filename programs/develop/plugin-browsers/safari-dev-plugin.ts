// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler} from '@rspack/core'
import {
  buildSourceFeatureIndex,
  classifyReloadFromSources,
  createChangedSourcesTracker,
  dispatchReload,
  formatReloadContextLabel,
  type ReloadBroker,
  type ReloadInstruction,
  readContentScriptCount
} from '../plugin-reload'
import {BuildEmitter, type RunnerPlugin} from './index'

// The dev plugin ignores whatever the packager reports back (only `build`
// folds it into a summary), so the return is deliberately unconstrained.
export type SafariPackagerFn = (
  distPath: string,
  mode: 'full' | 'resync'
) => Promise<unknown>

// Safari reloads through the same control bridge every other engine uses, and
// the dev server runs the bundler in watch mode. This plugin rides that watch
// loop: the first
// successful compile blocks for the full package
// (convert > xcodebuild > open > guided enable); every later compile resyncs
// xcodebuild in the background so the bundler loop is never blocked, and a
// burst of saves collapses to a single follow-up against the newest output.
type SafariPackageTarget = {
  outputPath: string
  contextDir: string
  instruction?: ReloadInstruction
}

function union(
  previous: string[] | undefined,
  next: string[] | undefined
): string[] {
  return [...new Set([...(previous || []), ...(next || [])])].sort()
}

// What is still worth sending once the package has landed. xcodebuild replaces
// the appex under a running Safari, so the extension restarts on its own and a
// full or service-worker reload would only restart what just started.
// Content scripts are the exception: a restart does not re-inject them, so an
// open tab keeps running the old code until this frame reaches it.
export function reloadSurvivingPackage(
  instruction: ReloadInstruction | undefined
): ReloadInstruction | undefined {
  if (!instruction) return undefined
  // 'page' is notify-only, it restarts nothing and carries the announcement.
  if (instruction.type === 'content-scripts' || instruction.type === 'page') {
    return instruction
  }

  const entries = instruction.changedContentScriptEntries || []
  if (entries.length === 0) return undefined

  // A source shared by the background and a content script. The restart covers
  // the background half, the open tabs still need the new content code.
  return {
    ...instruction,
    type: 'content-scripts',
    label: formatReloadContextLabel(
      'content_script',
      instruction.changedAssets || []
    )
  }
}

// A save burst collapses to one package, so its reloads collapse to one signal,
// labelled by the newest content edit. Entries union across the burst, because
// every content entry it touched still has to reach its open tabs.
function mergeInstructions(
  previous: ReloadInstruction | undefined,
  next: ReloadInstruction | undefined
): ReloadInstruction | undefined {
  if (!previous) return next
  if (!next) return previous

  const entries = union(
    previous.changedContentScriptEntries,
    next.changedContentScriptEntries
  )
  const scriptFiles = union(
    previous.changedScriptFiles,
    next.changedScriptFiles
  )
  if (entries.length === 0) {
    return scriptFiles.length > 0
      ? {...next, changedScriptFiles: scriptFiles}
      : next
  }

  // Keep the newest instruction that names content work, so the label points at
  // a content edit rather than at a page edit that rode along with it.
  const base = next.type === 'content-scripts' ? next : previous
  return {
    ...base,
    changedContentScriptEntries: entries,
    ...(scriptFiles.length > 0 ? {changedScriptFiles: scriptFiles} : {})
  }
}

export class SafariDevPlugin implements RunnerPlugin {
  static readonly name = 'safari-dev'

  readonly emitter = new BuildEmitter()
  extensionsToLoad: string[] = []

  private firstRun = true
  private active = false
  private pending: SafariPackageTarget | null = null
  private idleWaiters: Array<() => void> = []
  private reloadBroker: ReloadBroker | undefined

  constructor(private readonly packager: SafariPackagerFn) {}

  // Duck-typed by the dev server, the same seam the launched-browser plugin has.
  setReloadBroker(broker: ReloadBroker): void {
    this.reloadBroker = broker
  }

  apply(compiler: Compiler) {
    // Only a watching compiler reports changed sources, and only a watch has
    // anything to reload. Without it the plugin still packages, silently.
    const changedSources = compiler.hooks?.watchRun
      ? createChangedSourcesTracker(compiler)
      : undefined

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
      let instruction: ReloadInstruction | undefined
      if (!this.firstRun && changedSources) {
        const {forcedFull, changedSources: sources} = changedSources.snapshot()
        // Safari takes the same granularity as Chromium. A content-script
        // reinjection was measured working there, same tab, through the
        // producer's executeScript path. The package then restarts the
        // extension, so only the part a restart cannot deliver is kept.
        instruction = reloadSurvivingPackage(
          classifyReloadFromSources({
            changedSources: sources,
            forcedFull,
            getContentScriptCount: () =>
              readContentScriptCount(compilation, outputPath),
            getSourceFeatureIndex: () =>
              buildSourceFeatureIndex(compilation, contextDir),
            outputPath
          })
        )
      }

      const target: SafariPackageTarget = {
        outputPath,
        contextDir,
        instruction
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
        this.pending = {
          ...target,
          instruction: mergeInstructions(
            this.pending?.instruction,
            target.instruction
          )
        }
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

    // Only after the package succeeded: the appex Safari reads is replaced by
    // xcodebuild, so a signal sent earlier would reload the previous bytes.
    // The instruction is already trimmed to what the restart cannot deliver.
    if (!wasFirstRun && target.instruction && this.reloadBroker) {
      await dispatchReload(target.instruction, {
        broker: this.reloadBroker,
        // xcodebuild replaced the appex under a running Safari, so the extension
        // is restarting and a zero-producer dispatch here is the expected cost.
        producerRestartExpected: true
      })
    }

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
