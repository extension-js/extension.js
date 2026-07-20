// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import colors from 'pintor'
import type {ReloadInstruction} from './classify-reload'

// Every dev mode reloads through the control-bridge broker (the SW producer's
// re-injection); CDP/RDP controllers are kept for logging only, NOT reload.
export interface ReloadBroker {
  broadcastReload(instruction: {
    type: ReloadInstruction['type']
    changedContentScriptEntries?: string[]
    label?: string
    changedFiles?: string[]
  }): number
  // When a broadcast reached zero producers, an optional operator warning
  // (grace-gated + deduped by the broker), or null; optional for test doubles.
  undeliveredReloadWarning?(): string | null
}

export interface ReloadExecutor {
  broker?: ReloadBroker
}

function viaBroker(
  broker: ReloadBroker,
  instruction: ReloadInstruction
): number {
  return broker.broadcastReload({
    type: instruction.type,
    changedContentScriptEntries: instruction.changedContentScriptEntries,
    label: instruction.label,
    changedFiles: instruction.changedAssets
  })
}

// The one stdout announcement per dispatched reload: one server-built string
// echoed by producer console and devtools pill, zero drift.
export function formatReloadingLine(label: string): string {
  return `Reloading ${colors.brightBlue(label)}…`
}

// The single place deciding HOW a classified reload executes: the SW producer
// re-injects via the bridge for launched AND --no-browser. Honors EXTENSION_NO_RELOAD.
export async function dispatchReload(
  instruction: ReloadInstruction | undefined,
  executor: ReloadExecutor
): Promise<void> {
  if (!instruction) return
  if (process.env.EXTENSION_NO_RELOAD === 'true') return

  if (executor.broker) {
    const notified = viaBroker(executor.broker, instruction)

    // Announce only when at least one live instance received the signal; with zero
    // producers nothing reloads and printing "Reloading..." would be a lie.
    if (notified > 0) {
      if (instruction.label) console.log(formatReloadingLine(instruction.label))
      return
    }

    // Zero producers: the edit compiled but reached no page. Surface the broker's
    // deduped hint past the grace window so the no-op is diagnosable.
    const warning = executor.broker.undeliveredReloadWarning?.()
    if (warning) console.warn(warning)
  }
}

export interface ChangedSourcesSnapshot {
  /** A manifest.json / _locales change, forces a full reload regardless of which other files changed. */
  forcedFull: boolean
  /** Project-relative, forward-slashed paths of every file changed since the last compile. */
  changedSources: string[]
}

export interface ChangedSourcesTracker {
  snapshot(): ChangedSourcesSnapshot
}

// Taps watchRun and records changed files for the next compile, shared by both
// reload paths; read via snapshot() in done and feed classifyReloadFromSources.
export function createChangedSourcesTracker(
  compiler: Compiler
): ChangedSourcesTracker {
  let forcedFull = false
  let changedSources: string[] = []

  compiler.hooks.watchRun.tap('extjs-reload-changed-sources', () => {
    forcedFull = false
    changedSources = []
    const modifiedFiles = compiler.modifiedFiles as Set<string> | undefined
    if (!modifiedFiles || modifiedFiles.size === 0) return

    const contextDir = compiler.options.context || ''
    for (const file of modifiedFiles) {
      const normalized = path.relative(contextDir, file).replace(/\\/g, '/')
      // rspack sometimes reports the watch root itself as modified; it relativizes
      // to '' and would leak a dangling comma into the reload label.
      if (!normalized) continue
      changedSources.push(normalized)
      if (
        normalized.includes('manifest.json') ||
        normalized.includes('_locales/')
      ) {
        forcedFull = true
      }
    }
  })

  return {
    snapshot: () => ({forcedFull, changedSources})
  }
}
