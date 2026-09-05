// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {prefix} from '../lib/messaging'
import type {ReloadInstruction} from './classify-reload'

// Every dev mode reloads through the control-bridge broker (the SW producer's
// re-injection); CDP/RDP controllers are kept for logging only, NOT reload.
export interface ReloadBroker {
  broadcastReload(instruction: {
    type: ReloadInstruction['type']
    changedContentScriptEntries?: string[]
    label?: string
    changedFiles?: string[]
    changedScriptFiles?: string[]
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
    changedFiles: instruction.changedAssets,
    ...(instruction.changedScriptFiles?.length
      ? {changedScriptFiles: instruction.changedScriptFiles}
      : {})
  })
}

// The one stdout announcement per dispatched reload: one server-built string
// echoed by producer console and devtools pill, zero drift.
export function formatReloadingLine(label: string): string {
  return `${prefix('info')} Reloading ${label}…`
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
  /** Project-relative, forward-slashed paths of every file changed since the last successful compile. */
  changedSources: string[]
}

export interface ChangedSourcesTracker {
  snapshot(): ChangedSourcesSnapshot
}

function isForcedFullPath(normalized: string): boolean {
  return (
    normalized.includes('manifest.json') || normalized.includes('_locales/')
  )
}

function isHotAsset(normalized: string): boolean {
  return normalized.startsWith('hot/') || normalized.includes('.hot-update.')
}

function isDirectory(absolute: string): boolean {
  try {
    return fs.statSync(absolute).isDirectory()
  } catch {
    return false
  }
}

function normalizeChangedPath(
  file: string,
  contextDir: string
): string | undefined {
  const raw = String(file || '')
  if (!raw) return undefined
  // A watched folder (public/, the project root) is reported beside the file
  // that changed inside it; only the file is a source worth naming.
  if (path.isAbsolute(raw) && isDirectory(raw)) return undefined
  const normalized = path.isAbsolute(raw)
    ? path.relative(contextDir, raw).replace(/\\/g, '/')
    : raw.replace(/\\/g, '/')
  // rspack sometimes reports the watch root itself as modified; it relativizes
  // to '' and would leak a dangling comma into the reload label.
  if (!normalized) return undefined
  return normalized
}

function pushChanged(
  into: string[],
  file: string,
  contextDir: string,
  markForced: () => void
): void {
  const normalized = normalizeChangedPath(file, contextDir)
  if (!normalized) return
  if (!into.includes(normalized)) into.push(normalized)
  if (isForcedFullPath(normalized)) markForced()
}

// Taps watchRun and records changed files for the next compile, shared by both
// reload paths; read via snapshot() in done and feed classifyReloadFromSources.
// A failed compile does not emit (emitOnErrors: false), so its files stay
// pending until the next successful snapshot: a typo-fix must still reload
// the permission change that rode along with it, and a recovery that reports
// no modifiedFiles must still reload everything the success actually wrote.
export function createChangedSourcesTracker(
  compiler: Compiler
): ChangedSourcesTracker {
  let forcedFull = false
  let changedSources: string[] = []
  let heldForcedFull = false
  let heldSources: string[] = []
  let writtenAssets: string[] = []

  const contextDir = () => compiler.options.context || ''

  const ingest = (
    files: Iterable<string> | undefined,
    into: string[],
    markForced: () => void
  ) => {
    if (!files) return
    const ctx = contextDir()
    for (const file of files) pushChanged(into, file, ctx, markForced)
  }

  const foldRecoveryIntoCurrent = () => {
    const recovering = heldSources.length > 0 || heldForcedFull
    if (!recovering) return
    for (const file of heldSources) {
      if (!changedSources.includes(file)) changedSources.push(file)
    }
    for (const file of writtenAssets) {
      if (!changedSources.includes(file)) changedSources.push(file)
    }
    forcedFull =
      forcedFull ||
      heldForcedFull ||
      writtenAssets.some((file) => isForcedFullPath(file))
    heldSources = []
    heldForcedFull = false
  }

  const markForced = () => {
    forcedFull = true
  }

  compiler.hooks.watchRun.tap('extjs-reload-changed-sources', () => {
    forcedFull = false
    changedSources = []
    writtenAssets = []
    ingest(
      compiler.modifiedFiles as Set<string> | undefined,
      changedSources,
      markForced
    )
  })

  compiler.hooks.done?.tap?.(
    'extjs-reload-changed-sources-done',
    (stats: {
      compilation?: {errors?: unknown[]; modifiedFiles?: Iterable<string>}
    }) => {
      const compilation = stats?.compilation
      ingest(compilation?.modifiedFiles, changedSources, markForced)
      ingest(
        compiler.modifiedFiles as Set<string> | undefined,
        changedSources,
        markForced
      )

      if (compilation?.errors && compilation.errors.length > 0) {
        heldForcedFull = heldForcedFull || forcedFull
        for (const file of changedSources) {
          if (!heldSources.includes(file)) heldSources.push(file)
        }
        return
      }

      // Success with no consumer snapshot (first compile) must not leak held
      // files into the next unrelated edit.
      foldRecoveryIntoCurrent()
    }
  )

  compiler.hooks.assetEmitted?.tap?.(
    'extjs-reload-changed-sources-emitted',
    (file: string) => {
      const normalized = normalizeChangedPath(file, contextDir())
      if (!normalized || isHotAsset(normalized)) return
      if (!writtenAssets.includes(normalized)) writtenAssets.push(normalized)
    }
  )

  return {
    snapshot: () => {
      foldRecoveryIntoCurrent()
      return {forcedFull, changedSources}
    }
  }
}
