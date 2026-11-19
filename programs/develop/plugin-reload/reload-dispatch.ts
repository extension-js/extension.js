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
import type {
  BootRegistrationsOutcome,
  LateReloadRestart,
  ReloadAckOutcome,
  ReloadRestartOutcome
} from '../dev-server/control-bridge/contracts'
import {humanLine} from '../dev-server/lifecycle-stream'
import {prefix} from '../lib/messaging'
import {
  filesBehindFolders,
  readsOfCompilation,
  relativePublicRootsOf,
  wasReadByBuild
} from './build-reads'
import type {ReloadInstruction} from './classify-reload'
import * as reloadMessages from './messages'
import {projectRelative} from './project-relative'

// Every reload goes through the control-bridge broker, never CDP or RDP. RDP
// still wakes a suspended Firefox background so a latched reload is delivered.
export interface UndeliveredReloadContext {
  // True when the caller restarted the extension to ship this build, so a
  // zero-producer broadcast is expected rather than a fault to report.
  producerRestartExpected?: boolean
}

export interface ReloadBroker {
  broadcastReload(instruction: {
    type: ReloadInstruction['type']
    changedContentScriptEntries?: string[]
    label?: string
    changedFiles?: string[]
    changedScriptFiles?: string[]
    refreshedStylesheets?: {file: string; digest: string}[]
    standalonePages?: string[]
    build?: string
  }): number
  // True when every connected background already runs this build.
  runsBuild?(build: string): boolean
  // When a broadcast reached zero producers, an optional operator warning
  // (grace-gated + deduped by the broker), or null; optional for test doubles.
  undeliveredReloadWarning?(context?: UndeliveredReloadContext): string | null
  // Starts a background the browser suspended so its hello takes the latched
  // broadcast, and resolves true once a producer received it.
  deliverLatchedReload?(): Promise<boolean>
  // The receipt for the newest broadcast. 'not-expected' covers a producer
  // that cannot ack, so an old cached worker is never called unapplied.
  awaitReloadAck?(): Promise<ReloadAckOutcome>
  // The open tabs the acked reload ran its edited files in again.
  reloadReplayedTabs?(): number
  // Whether the extension came back after an acked reload that restarts it.
  awaitReloadRestart?(): Promise<ReloadRestartOutcome>
  // The hello that arrived after that restart was already called missing.
  awaitLateReloadRestart?(): Promise<LateReloadRestart | null>
  // Resolves once a background says its boot registry calls answered, or
  // with 'timeout' when none says so inside the window.
  awaitBootRegistrations?(timeoutMs: number): Promise<BootRegistrationsOutcome>
  // Stamps the applied reload into ready.json, so a tool waiting for the
  // rebuild to be live reads it instead of guessing from a reconnect.
  noteReloadApplied?(kind: ReloadKind, label?: string): void
}

// The public names ready.json publishes in reloadKind. safari-resync is the
// appex Safari reloads after a rebuild, stamped by the Safari dev plugin.
export type ReloadKind =
  | 'full'
  | 'background'
  | 'content'
  | 'page'
  | 'safari-resync'

export function reloadKindFor(type: ReloadInstruction['type']): ReloadKind {
  if (type === 'service-worker') return 'background'
  if (type === 'content-scripts') return 'content'
  if (type === 'page') return 'page'

  return 'full'
}

export interface ReloadExecutor {
  broker?: ReloadBroker
  // Safari packages by replacing the appex under a running browser, which takes
  // the extension down. The dispatch that follows must not call that a fault.
  producerRestartExpected?: boolean
  // The digest of the build being shipped. A worker that names it already
  // runs what a reload that only restarts the worker would give it.
  build?: string
}

// The same value the background bundle of that compilation names itself by.
export const DEV_BUILD_GLOBAL = '__extjsDevBuild'

// Two quick saves can compile the same bytes twice, and the worker that
// restarted for the first compile already read them from disk.
function workerAlreadyRuns(
  instruction: ReloadInstruction,
  executor: ReloadExecutor
): boolean {
  return (
    instruction.type === 'service-worker' &&
    !instruction.changedContentScriptEntries?.length &&
    !instruction.changedScriptFiles?.length &&
    !instruction.refreshedStylesheets?.length &&
    !instruction.standalonePages?.length &&
    !!executor.build &&
    executor.broker?.runsBuild?.(executor.build) === true
  )
}

function viaBroker(
  broker: ReloadBroker,
  instruction: ReloadInstruction,
  build?: string
): number {
  return broker.broadcastReload({
    type: instruction.type,
    changedContentScriptEntries: instruction.changedContentScriptEntries,
    label: instruction.label,
    changedFiles: instruction.changedAssets,
    ...(instruction.changedScriptFiles?.length
      ? {changedScriptFiles: instruction.changedScriptFiles}
      : {}),
    ...(instruction.refreshedStylesheets?.length
      ? {refreshedStylesheets: instruction.refreshedStylesheets}
      : {}),
    ...(instruction.standalonePages?.length
      ? {standalonePages: instruction.standalonePages}
      : {}),
    ...(build ? {build} : {})
  })
}

async function wakeDelivered(broker: ReloadBroker): Promise<boolean> {
  try {
    return (await broker.deliverLatchedReload?.()) === true
  } catch {
    return false
  }
}

// The one stdout announcement per dispatched reload: one server-built string
// echoed by producer console and devtools pill, zero drift.
export function formatReloadingLine(label: string): string {
  return `${prefix('info')} Reloading ${label}…`
}

// A page reload that only ran injected files again reloaded no page, so the
// line names the files and the tabs. Every other reload keeps its own line.
export function appliedReloadLine(
  instruction: ReloadInstruction,
  broker: ReloadBroker
): string {
  const label = instruction.label ?? ''

  if (instruction.staticContentScriptEntries?.length) {
    return reloadMessages.reloadingExtensionForStaticContentScript(label)
  }

  const tabs =
    instruction.type === 'page' && instruction.changedScriptFiles?.length
      ? (broker.reloadReplayedTabs?.() ?? 0)
      : 0
  const files = instruction.changedAssets?.length
    ? instruction.changedAssets
    : instruction.changedScriptFiles

  if (tabs > 0 && files?.length) {
    return reloadMessages.ranInjectedFilesAgain(files, tabs)
  }

  // Only a changed page markup or a page shipped as written reloads its tab.
  // The dev client applies any other page edit where the page is open.
  if (
    instruction.type === 'page' &&
    !instruction.standalonePages?.length &&
    !instruction.changedAssets?.some((file) => /\.html?$/i.test(file))
  ) {
    return reloadMessages.updatedPage(label)
  }

  return formatReloadingLine(label)
}

// The ack window closed with no receipt: the frame reached an open socket and
// the worker still never said it applied the edit, so say exactly that.
export function formatUnappliedReloadLine(label: string): string {
  return (
    `${prefix('warn')} ${label} compiled but the extension never confirmed ` +
    'the reload, so this edit may not be live. Save again, or reload the ' +
    'extension from the browser.'
  )
}

// The worker acked the reload and then never said hello again, so the edit
// was handed over and the extension is not there to run it.
export function formatNotRestartedLine(label: string): string {
  return (
    `${prefix('warn')} ${label} reloaded but the extension has not come back ` +
    'since, so this edit may not be live. Reload the extension from the ' +
    'browser.'
  )
}

// The extension said hello after the line above was printed, so the verdict
// is taken back: a slow restart is not a lost one.
export function formatLateRestartLine(
  label: string,
  late: LateReloadRestart
): string {
  const seconds = Math.max(1, Math.round(late.afterMs / 1000))

  return late.runsBuild
    ? `${prefix('info')} ${label} is back after ${seconds}s, so this edit is live. Nothing to reload.`
    : `${prefix('warn')} ${label} is back after ${seconds}s on an earlier build, ` +
        'so this edit is not live. Reload the extension from the browser.'
}

// The zero-producer line for a caller that restarted the extension itself. The
// broker latched the instruction, so the reconnecting producer still applies it.
export function formatQueuedReloadLine(label: string): string {
  return `${prefix('info')} Queued ${label} for the extension to apply when it reconnects.`
}

// The reloads that restarted the whole extension, counted per broker, so a
// caller can tell whether a build in between already did what it plans to.
const fullReloadsDelivered = new WeakMap<object, number>()

export function fullReloadsDeliveredTo(
  broker: ReloadBroker | undefined
): number {
  return (broker && fullReloadsDelivered.get(broker)) || 0
}

// A restarted session reloads the extension once for its new entry set. The
// first build of the new compiler may have reloaded it for its manifest.
export async function dispatchRestartReload(
  executor: ReloadExecutor,
  fullReloadsBefore: number
): Promise<boolean> {
  if (fullReloadsDeliveredTo(executor.broker) > fullReloadsBefore) return false

  return dispatchReload({type: 'full', label: 'extension'}, executor)
}

// The single place deciding HOW a classified reload executes: the SW producer
// re-injects via the bridge for launched AND --no-browser. Honors EXTENSION_NO_RELOAD.
// Resolves true only when a producer took the instruction and did not leave
// it unconfirmed, so a caller never counts an edit nobody received as shown.
export async function dispatchReload(
  instruction: ReloadInstruction | undefined,
  executor: ReloadExecutor
): Promise<boolean> {
  if (!instruction) return false
  if (process.env.EXTENSION_NO_RELOAD === 'true') return false

  if (workerAlreadyRuns(instruction, executor)) return true

  if (executor.broker) {
    try {
      return await dispatchViaBroker(instruction, executor, executor.broker)
    } catch {
      // A broker fault must not fail the compile that produced the edit.
      if (instruction.label) {
        console.warn(formatUnappliedReloadLine(instruction.label))
      }

      return false
    }
  }

  return false
}

async function dispatchViaBroker(
  instruction: ReloadInstruction,
  executor: ReloadExecutor,
  broker: ReloadBroker
): Promise<boolean> {
  let notified = viaBroker(broker, instruction, executor.build)

  // Firefox suspends an idle event page and its producer with it, so an
  // edit after a quiet spell finds nobody until the page is started again.
  if (notified === 0 && (await wakeDelivered(broker))) notified = 1

  // Announce only when the extension confirmed it applied the edit. A
  // producer that cannot ack resolves 'not-expected', so those sessions keep
  // announcing on a confirmed send rather than warning on every save.
  if (notified > 0) {
    const ack = (await broker.awaitReloadAck?.()) ?? 'not-expected'

    if (ack === 'unacked') {
      if (instruction.label) {
        console.warn(formatUnappliedReloadLine(instruction.label))
      }

      return false
    }

    broker.noteReloadApplied?.(
      reloadKindFor(instruction.type),
      instruction.label
    )

    if (instruction.type === 'full') {
      fullReloadsDelivered.set(broker, fullReloadsDeliveredTo(broker) + 1)
    }

    if (instruction.label) {
      humanLine(appliedReloadLine(instruction, broker))
    }

    // The restart outlives this dispatch, so its verdict is reported when it
    // arrives and never holds the next compile.
    const label = instruction.label
    const restart = broker.awaitReloadRestart?.()
    const lateRestart = broker.awaitLateReloadRestart?.()

    if (restart && label) {
      void restart.then(
        (outcome) => {
          if (outcome !== 'not-restarted') return

          console.warn(formatNotRestartedLine(label))

          void lateRestart?.then(
            (late) => {
              if (!late) return

              if (late.runsBuild) {
                humanLine(formatLateRestartLine(label, late))
              } else {
                console.warn(formatLateRestartLine(label, late))
              }
            },
            () => undefined
          )
        },
        () => undefined
      )
    }

    return true
  }

  // Zero producers: the edit compiled but reached no page. Surface the broker's
  // deduped hint past the grace window so the no-op is diagnosable.
  const warning = broker.undeliveredReloadWarning?.(
    executor.producerRestartExpected
      ? {producerRestartExpected: true}
      : undefined
  )

  if (warning) {
    console.warn(warning)

    return false
  }

  // A restart the caller caused is not a failure, so name what happens to this
  // edit rather than leaving the save loop with nothing to show.
  if (executor.producerRestartExpected && instruction.label) {
    humanLine(formatQueuedReloadLine(instruction.label))
  }

  return false
}

export interface ChangedSourcesSnapshot {
  forcedFull: boolean
  changedSources: string[]
}

export interface ChangedSourcesTracker {
  snapshot(): ChangedSourcesSnapshot
}

// The manifest each compiler builds, as ReloadPlugin was given it.
const manifestPaths = new WeakMap<object, string>()

export function noteManifestPath(compiler: object, manifestPath: string) {
  manifestPaths.set(compiler, manifestPath)
}

// The project-relative manifest a full reload is forced for. Without one
// noted, the two places a project keeps it.
function manifestSources(compiler: Compiler, contextDir: string): string[] {
  const noted = manifestPaths.get(compiler)

  if (noted) return [projectRelative(contextDir, noted)]

  return ['manifest.json', 'src/manifest.json']
}

// Only the manifest itself and the _locales folder beside it are read once
// at load, so only they need the whole extension reloaded.
function isForcedFullPath(normalized: string, manifests: string[]): boolean {
  return manifests.some((manifest) => {
    const folder = path.posix.dirname(manifest)
    const locales = folder === '.' ? '_locales/' : `${folder}/_locales/`

    return normalized === manifest || normalized.startsWith(locales)
  })
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
    ? projectRelative(contextDir, raw)
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
  manifests: string[],
  markForced: () => void
): void {
  const normalized = normalizeChangedPath(file, contextDir)
  if (!normalized) return
  if (!into.includes(normalized)) into.push(normalized)
  if (isForcedFullPath(normalized, manifests)) markForced()
}

// Taps watchRun and records changed files for the next compile, shared by both
// reload paths; read via snapshot() in done and feed classifyReloadFromSources.
// A failed compile does not emit (emitOnErrors: false), so its files stay
// pending until the next successful snapshot: a typo-fix must still reload
// the permission change that rode along with it, and a recovery that reports
// no modifiedFiles must still reload everything the success actually wrote.
// Only files the build read count: a saved note nothing imports reloads
// nothing, and a file a glob picks up or drops is named, not just its folder.
export function createChangedSourcesTracker(
  compiler: Compiler
): ChangedSourcesTracker {
  let forcedFull = false
  let changedSources: string[] = []
  let heldForcedFull = false
  let heldSources: string[] = []
  let writtenAssets: string[] = []
  let changedFolders: string[] = []
  let readBefore: Set<string> | undefined

  const contextDir = () => compiler.options.context || ''

  const ingest = (
    files: Iterable<string> | undefined,
    into: string[],
    markForced: () => void
  ) => {
    if (!files) return

    const ctx = contextDir()
    const manifests = manifestSources(compiler, ctx)

    for (const file of files) {
      const raw = String(file || '')

      if (path.isAbsolute(raw) && isDirectory(raw)) {
        if (!changedFolders.includes(raw)) changedFolders.push(raw)
      } else {
        pushChanged(into, file, ctx, manifests, markForced)
      }
    }
  }

  const changesOf = (source: {
    modifiedFiles?: Iterable<string>
    removedFiles?: Iterable<string>
  }) => [...(source.modifiedFiles || []), ...(source.removedFiles || [])]

  // Names the files behind a reported folder, then keeps the files this
  // compile or the one before it read. A compile that cannot say keeps all.
  const keepFilesTheBuildRead = (compilation: unknown, failed: boolean) => {
    const reads = readsOfCompilation(compilation)
    if (!reads) return

    const ctx = contextDir()
    const manifests = manifestSources(compiler, ctx)
    const named = filesBehindFolders({
      contextDir: ctx,
      folders: changedFolders,
      reads,
      readBefore
    })

    for (const rel of named) {
      pushChanged(changedSources, rel, ctx, manifests, markForced)
    }

    const publicRoots = relativePublicRootsOf(compiler, ctx)

    changedSources = changedSources.filter(
      (rel) =>
        isForcedFullPath(rel, manifests) ||
        wasReadByBuild(rel, {contextDir: ctx, reads, readBefore, publicRoots})
    )

    // A failed compile can stop short of a file, so what it read adds to the
    // compile before it rather than replacing it.
    readBefore =
      failed && readBefore
        ? new Set([...readBefore, ...reads.files])
        : reads.files
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
      // Emitted names are relative to the output root.
      writtenAssets.some((file) => isForcedFullPath(file, ['manifest.json']))

    heldSources = []
    heldForcedFull = false
  }

  const markForced = () => {
    forcedFull = true
  }

  // A save during a compile starts the next one and the first never reaches
  // done, so its files still wait for a reload.
  let compileEnded = true

  compiler.hooks.watchRun.tap('extjs-reload-changed-sources', () => {
    if (compileEnded) {
      forcedFull = false
      changedSources = []
      writtenAssets = []
      changedFolders = []
    }

    compileEnded = false
    ingest(changesOf(compiler), changedSources, markForced)
  })

  compiler.hooks.done?.tap?.(
    'extjs-reload-changed-sources-done',
    (stats: {
      compilation?: {errors?: unknown[]; modifiedFiles?: Iterable<string>}
    }) => {
      const compilation = stats?.compilation
      const failed = Boolean(compilation?.errors?.length)
      compileEnded = true
      ingest(compilation?.modifiedFiles, changedSources, markForced)
      ingest(changesOf(compiler), changedSources, markForced)
      keepFilesTheBuildRead(compilation, failed)

      if (failed) {
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
