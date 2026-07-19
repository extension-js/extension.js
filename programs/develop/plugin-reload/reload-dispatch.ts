// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {Compiler} from '@rspack/core'
import * as path from 'path'
import colors from 'pintor'
import type {ReloadInstruction} from './classify-reload'

// Every dev mode — launched (Chromium CDP / Firefox RDP) and `--no-browser` —
// reloads through the control-bridge `broker` (the in-extension SW producer's
// chrome.scripting re-injection). A launched browser's CDP/RDP controller is
// kept only for logging / source inspection, NOT reload.
export interface ReloadBroker {
  broadcastReload(instruction: {
    type: ReloadInstruction['type']
    changedContentScriptEntries?: string[]
    label?: string
    changedFiles?: string[]
  }): number
  /**
   * §53. When a broadcast reached zero producers, an optional operator warning
   * that the edit isn't reaching any page (grace-gated + deduped by the broker),
   * or null. Optional so launched-path executors / test doubles without it still
   * satisfy the interface.
   */
  undeliveredReloadWarning?(): string | null
}

export interface ReloadExecutor {
  broker?: ReloadBroker
}

/** Broadcast a reload over the control bridge to the SW producer. */
function viaBroker(broker: ReloadBroker, instruction: ReloadInstruction): number {
  return broker.broadcastReload({
    type: instruction.type,
    changedContentScriptEntries: instruction.changedContentScriptEntries,
    label: instruction.label,
    changedFiles: instruction.changedAssets
  })
}

/**
 * The one stdout announcement per dispatched reload. Prints the SAME label the
 * producer echoes into the page's devtools console and the devtools-extension
 * pill renders — one server-built string, three surfaces, zero drift.
 */
export function formatReloadingLine(label: string): string {
  return `Reloading ${colors.brightBlue(label)}…`
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
    const notified = viaBroker(executor.broker, instruction)

    // Announce only when at least one live extension instance received the
    // signal (`notified` producers). With zero producers nothing reloads
    // anywhere — printing "Reloading…" would be a lie. This also covers
    // `--no-browser` before/without an attached browser.
    if (notified > 0) {
      if (instruction.label) console.log(formatReloadingLine(instruction.label))
      return
    }

    // §53. Zero producers: the edit compiled but reached no page. That is
    // correct behavior (nothing to reload), but staying entirely silent makes a
    // heavy-site / auth-wall session where the SW never attaches look like a
    // broken tool. Past the startup grace window the broker hands back a single
    // deduped hint explaining why; surface it so the no-op is diagnosable.
    const warning = executor.broker.undeliveredReloadWarning?.()
    if (warning) console.warn(warning)
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
      // rspack sometimes reports the watch root itself as modified — it
      // relativizes to '' and would leak into the reload label as a dangling
      // comma ("(src/a.js, )").
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
