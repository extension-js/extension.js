// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {Compiler} from '@rspack/core'
import * as path from 'path'
import type {ReloadInstruction} from './index'

// Every dev mode — launched (Chromium CDP / Firefox RDP) and `--no-browser` —
// reloads through the control-bridge `broker` (the in-extension SW producer's
// chrome.scripting re-injection). A launched browser's CDP/RDP controller is
// kept only for logging / source inspection, NOT reload.
export interface ReloadBroker {
  broadcastReload(instruction: {
    type: ReloadInstruction['type']
    changedContentScriptEntries?: string[]
  }): number
}

export interface ReloadExecutor {
  broker?: ReloadBroker
}

/** Broadcast a reload over the control bridge to the SW producer. */
function viaBroker(broker: ReloadBroker, instruction: ReloadInstruction): void {
  broker.broadcastReload({
    type: instruction.type,
    changedContentScriptEntries: instruction.changedContentScriptEntries
  })
}

/**
 * The single place that decides HOW a classified reload is executed: the SW
 * producer re-injects via the control bridge, the SAME mechanism for launched
 * (Chromium + Firefox) and `--no-browser`. A launched browser's CDP/RDP
 * controller is kept for logging / source inspection, not reload.
 *
 * Both modes already share the reload DECISION (classifyReloadFromSources); this
 * is the shared dispatch seam. Honors EXTENSION_NO_RELOAD (emit the new dist,
 * but don't reload).
 */
export async function dispatchReload(
  instruction: ReloadInstruction | undefined,
  executor: ReloadExecutor
): Promise<void> {
  if (!instruction) return
  if (process.env.EXTENSION_NO_RELOAD === 'true') return

  if (executor.broker) {
    viaBroker(executor.broker, instruction)
  }
}

export interface ChangedSourcesSnapshot {
  /** A manifest.json / _locales change — forces a full reload regardless of which other files changed. */
  forcedFull: boolean
  /** Project-relative, forward-slashed paths of every file changed since the last compile. */
  changedSources: string[]
}

export interface ChangedSourcesTracker {
  snapshot(): ChangedSourcesSnapshot
}

/**
 * Taps `watchRun` and records the files changed for the next compile, shared by
 * the launched (BrowsersPlugin) and `--no-browser` (dev server) reload paths so
 * the collection logic isn't duplicated. Read it in the `done` hook via
 * `snapshot()` and feed it to classifyReloadFromSources.
 */
export function createChangedSourcesTracker(
  compiler: Compiler
): ChangedSourcesTracker {
  let forcedFull = false
  let changedSources: string[] = []

  compiler.hooks.watchRun.tap('extjs-reload-changed-sources', () => {
    forcedFull = false
    changedSources = []
    const modifiedFiles = (compiler as any).modifiedFiles as
      | Set<string>
      | undefined
    if (!modifiedFiles || modifiedFiles.size === 0) return

    const contextDir = compiler.options.context || ''
    for (const file of modifiedFiles) {
      const normalized = path.relative(contextDir, file).replace(/\\/g, '/')
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
