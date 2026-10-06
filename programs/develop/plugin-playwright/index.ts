// ██████╗ ██╗      █████╗ ██╗   ██╗██╗    ██╗██████╗ ██╗ ██████╗ ██╗  ██╗████████╗
// ██╔══██╗██║     ██╔══██╗╚██╗ ██╔╝██║    ██║██╔══██╗██║██╔════╝ ██║  ██║╚══██╔══╝
// ██████╔╝██║     ███████║ ╚████╔╝ ██║ █╗ ██║██████╔╝██║██║  ███╗███████║   ██║
// ██╔═══╝ ██║     ██╔══██║  ╚██╔╝  ██║███╗██║██╔══██╗██║██║   ██║██╔══██║   ██║
// ██║     ███████╗██║  ██║   ██║   ╚███╔███╔╝██║  ██║██║╚██████╔╝██║  ██║   ██║
// ╚═╝     ╚══════╝╚═╝  ╚═╝   ╚═╝    ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {
  isEmulatorBrowser,
  isGeckoBasedBrowser,
  isWebkitBasedBrowser
} from '../lib/constants'
import {
  chromiumExtensionId,
  geckoExtensionId,
  type ManagedExtensionRecord,
  managedExtensionRecords
} from '../lib/extension-id'
import * as messages from '../lib/messages'
import {humanWarn} from '../lib/messaging'
import {parseJsonSafe} from '../lib/parse-json-safe'
import {type AbsolutePath, asAbsolute} from '../lib/paths'
import {
  browserArtifactsDir,
  readyContractPath,
  eventsPath as sessionEventsPath
} from '../lib/session-paths'
import packageJson from '../package.json'

export type PlaywrightAutomationCommand = 'dev' | 'start' | 'preview' | 'build'
// 'stopped' is stamped at watch close so a dead session can never keep
// advertising status:"ready" to controllers.
export type ReadyStatus = 'starting' | 'ready' | 'error' | 'stopped'

export type ReadyMetadata = {
  // The ready contract's own version. Independent of `schema` below, which
  // advertises that this engine speaks the schema-1 result envelope.
  schemaVersion: 2
  schema: 1
  status: ReadyStatus
  command: PlaywrightAutomationCommand
  browser: string
  runId: string
  startedAt: string
  distPath: string
  manifestPath: string
  port: number | null
  host?: string
  pid: number
  ts: string
  compiledAt: string | null
  errors: string[]
  code?: string
  message?: string
  instanceId?: string
  instanceExplicit?: boolean
  controlPort?: number | null
  // Why `controlPort` is null: without it a reader cannot tell a session that
  // never asked for a control bridge from one whose bridge could not bind.
  controlPortUnavailableReason?: string
  controlPath?: string
  logsPath?: string
  cdpPort?: number
  // Gecko launches only: the RDP debugger-server port, stamped by the Firefox
  // launcher post-launch (the CDP-extras pairing seam for downstream tooling).
  rdpPort?: number
  // Safari dev sessions only: the safaridriver session the launcher holds
  // beside the app, or why it holds none. Stamped post-launch.
  webdriverPort?: number
  webdriverSessionId?: string
  webdriverUnavailableReason?: string
  // Stamped by the browser launcher post-launch: the resolved profile dir (an
  // ephemeral profile's leaf name is generated) and the browser process pid.
  profilePath?: string
  browserPid?: number | null
  engine?: 'emulator'
  // The pid the launcher spawned, kept once the browser handed the session to
  // another process; browserPid then names that live process.
  launcherPid?: number
  // Provenance: which toolchain produced this tree, for which extension;
  // ready.json doubles as a build receipt for one-shot builds.
  toolchainVersion: string
  extensionName?: string
  extensionVersion?: string
  // The id the browser serves the dist under: browser-confirmed when the
  // launcher stamped it, otherwise derived the way the browser derives it.
  extensionId?: string
  // Stamped by the browser launcher when the browser exits mid-session
  // without the dev server asking it to; preserved across recompiles.
  browserExitedAt?: string
  browserExitCode?: number | null
  browserExitSignal?: string | null
  // Stamped by the launcher when no browser process came up at all (a spawn
  // refusal, a missing binary, a bad pin), preserved across recompiles.
  browserLaunchFailedAt?: string
  browserLaunchFailedReason?: string
  browserLaunchFailedCode?: string
  // Runtime attachment signal: 'ready' means compiled; these mean the SW has
  // connected and can be driven. Act-tooling should wait for runtime:'attached'.
  runtime?: 'attached' | 'detached'
  executorAttachedAt?: string
  // Every extension the engine loads besides the user's (built-in companions
  // plus --extensions dirs), so a target census can subtract them by id.
  managedExtensions?: ManagedExtensionRecord[]
}

export type PlaywrightAutomationEvent = {
  type:
    | 'compile_start'
    | 'compile_success'
    | 'compile_error'
    | 'shutdown'
    | 'browser_exited'
    | 'browser_launch_failed'
  ts: string
  command: PlaywrightAutomationCommand
  browser: string
  runId?: string
  durationMs?: number
  errorCount?: number
  errors?: string[]
  // browser_exited: the launcher's exit evidence, mirrored off ready.json so
  // the timeline says when and how the browser went, not only the compiles.
  exitCode?: number | null
  exitSignal?: string | null
  browserExitedAt?: string
  // browser_launch_failed: when the launcher gave up and why, off ready.json.
  browserLaunchFailedAt?: string
  reason?: string
  // Set when the per-event byte cap trimmed this row's error text, so a reader
  // never mistakes a shortened message for the whole diagnostic.
  truncated?: boolean
}

type WriterOptions = {
  packageJsonDir: string
  browser: string
  command: PlaywrightAutomationCommand
  distPath: string
  manifestPath: string
  port?: number | string | null
  host?: string
  instanceId?: string
  instanceExplicit?: boolean
  controlPort?: number | string | null
  controlPortUnavailableReason?: string | null
  controlPath?: string
  logsPath?: string
  managedExtensionDirs?: string[]
}

type PluginOptions = {
  packageJsonDir: string
  browser?: string
  mode?: 'development' | 'production' | 'none'
  outputPath: string
  manifestPath: string
  port?: number | string | null
  host?: string
  command?: PlaywrightAutomationCommand
  instanceId?: string
  instanceExplicit?: boolean
  controlPort?: number | string | null
  controlPortUnavailableReason?: string | null
  controlPath?: string
  logsPath?: string
  managedExtensionDirs?: string[]
  launchFollows?: boolean
}

function nowISO() {
  return new Date().toISOString()
}

const MAX_CONTRACT_ERRORS = 10

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g

// ready.json/events.ndjson are machine contracts (--wait, --attach, MCP);
// error text must be plain so consumers never have to ANSI-strip.
export function formatStatsErrors(errors: unknown): string[] {
  if (!Array.isArray(errors)) return []

  return errors
    .slice(0, MAX_CONTRACT_ERRORS)
    .map((error) => {
      const message =
        error && typeof error === 'object'
          ? String((error as {message?: unknown}).message ?? '')
          : String(error ?? '')

      return message.replace(ANSI_PATTERN, '').trim()
    })
    .filter(Boolean)
}

// events.ndjson is append-only for a whole session and a project that keeps
// failing to compile appends ten full error texts per save, so it carries the
// same budget and generational rotation as logs.ndjson and actions.ndjson.
const MAX_EVENTS_BYTES = 8 * 1024 * 1024
const MAX_EVENTS_LINES = 50_000
const EVENTS_GENERATIONS = 3
const MAX_EVENT_BYTES = 64 * 1024

function rotatedEventsName(eventsPath: string, generation: number): string {
  return eventsPath.replace(/\.ndjson$/, `.${generation}.ndjson`)
}

function rotateEventsFile(eventsPath: string) {
  try {
    const oldest = rotatedEventsName(eventsPath, EVENTS_GENERATIONS)
    if (fs.existsSync(oldest)) fs.rmSync(oldest, {force: true})

    for (let n = EVENTS_GENERATIONS - 1; n >= 1; n--) {
      const from = rotatedEventsName(eventsPath, n)

      if (fs.existsSync(from)) {
        fs.renameSync(from, rotatedEventsName(eventsPath, n + 1))
      }
    }

    if (fs.existsSync(eventsPath)) {
      fs.renameSync(eventsPath, rotatedEventsName(eventsPath, 1))
    }
  } catch {
    // Ignore
  }
}

// A diagnostic-heavy failure writes one enormous line, so the error TEXT is
// trimmed rather than the JSON, which every consumer still has to parse.
function capEventSize(
  event: PlaywrightAutomationEvent
): PlaywrightAutomationEvent {
  if (Buffer.byteLength(JSON.stringify(event)) <= MAX_EVENT_BYTES) return event

  const errors = Array.isArray(event.errors) ? event.errors : []
  const perError = Math.floor(MAX_EVENT_BYTES / 2 / Math.max(1, errors.length))
  const trimmed: PlaywrightAutomationEvent = {
    ...event,
    errors: errors.map((message) => String(message).slice(0, perError)),
    truncated: true
  }

  if (Buffer.byteLength(JSON.stringify(trimmed)) <= MAX_EVENT_BYTES) {
    return trimmed
  }

  return {...event, errors: [], truncated: true}
}

function createRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// One runId per (project, browser) per process: compiler plugin and dev-server
// create separate writers, and events must attribute to ONE run.
const runIdByMetadataDir = new Map<string, string>()

function getRunIdForSession(metadataDir: string): string {
  const existing = runIdByMetadataDir.get(metadataDir)
  if (existing) return existing

  const runId = createRunId()
  runIdByMetadataDir.set(metadataDir, runId)

  return runId
}

// The session's ONE run identity: ready.json, events.ndjson, and logs.ndjson
// rows must all stamp this value so consumers can join them on `runId`.
export function getSessionRunId(
  packageJsonDir: string,
  browser: string
): string {
  return getRunIdForSession(getPlaywrightMetadataDir(packageJsonDir, browser))
}

// Writers of one run are told apart by the epoch their writeStarting opened:
// a compiler torn down after its successor opened no longer owns the document.
const writerEpochByMetadataDir = new Map<string, number>()

// The dev server and its compiler plugin each open a writer on the same run,
// so the other session is noticed twice and told of once.
const devOverDevWarnedByMetadataDir = new Set<string>()

// The one identifier a consumer cannot read from the manifest alone: gecko
// declares it, chromium hashes the manifest key or the loaded dist path.
// Safari has no dist-derivable id at all: identity is the appex bundle id
// the packager resolves, stamped later via stampReadyKnownExtensionId.
function deriveDistExtensionId(
  browser: string,
  distPath: string
): string | undefined {
  try {
    if (isWebkitBasedBrowser(browser) || isEmulatorBrowser(browser)) {
      return undefined
    }

    if (!fs.existsSync(path.join(distPath, 'manifest.json'))) return undefined

    const id = isGeckoBasedBrowser(browser)
      ? geckoExtensionId(distPath)
      : chromiumExtensionId(distPath)

    return id || undefined
  } catch {
    return undefined
  }
}

// Backfill only: a browser-confirmed or earlier stamp always outranks a
// late derivation, so an existing id is never overwritten here.
function stampReadyExtensionIdIfAbsent(
  packageJsonDir: string,
  browser: string,
  extensionId: string
): void {
  try {
    const readyPath = readyContractPath(packageJsonDir, browser)
    if (!fs.existsSync(readyPath)) return

    const prev = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    if (typeof prev.extensionId === 'string' && prev.extensionId) return

    prev.extensionId = extensionId
    prev.ts = nowISO()
    writeJsonAtomic(readyPath, prev)
  } catch {
    // Ignore
  }
}

// One-shot builds stamp ready.json at compile done, before the staging dist
// is promoted, so a first build finds no manifest at distPath yet. The build
// command calls this after the promote to backfill the derived id only.
export function stampReadyDistExtensionId(
  packageJsonDir: string,
  browser: string,
  distPath: string
): void {
  const derived = deriveDistExtensionId(browser, distPath)
  if (!derived) return

  stampReadyExtensionIdIfAbsent(packageJsonDir, browser, derived)
}

// Safari's identity cannot be derived from the dist: the packager resolves
// the appex bundle id, and the build command backfills that known value here.
export function stampReadyKnownExtensionId(
  packageJsonDir: string,
  browser: string,
  extensionId: string
): void {
  if (!extensionId) return

  stampReadyExtensionIdIfAbsent(packageJsonDir, browser, extensionId)
}

// Candidates in preference order. The loaded directory describes the run, so a
// stale dist is reported as what the browser took, not as the unbuilt source.
function readManifestProvenance(...manifestPaths: Array<string | undefined>): {
  extensionName?: string
  extensionVersion?: string
} {
  for (const manifestPath of manifestPaths) {
    if (!manifestPath) continue

    try {
      const manifest = parseJsonSafe(fs.readFileSync(manifestPath, 'utf-8'))
      const extensionName =
        typeof manifest?.name === 'string' ? manifest.name : undefined
      const extensionVersion =
        typeof manifest?.version === 'string' ? manifest.version : undefined

      if (extensionName || extensionVersion) {
        return {extensionName, extensionVersion}
      }
    } catch {
      // Ignore
    }
  }

  return {}
}

function ensureDirSync(dirPath: string) {
  try {
    fs.mkdirSync(dirPath, {recursive: true})
  } catch {
    // Ignore
  }
}

function writeJsonAtomic(filePath: string, value: unknown) {
  try {
    const tmpPath = `${filePath}.tmp-${process.pid}`
    fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch {
    // Ignore
  }
}

export interface LiveDevSessionOwner {
  pid: number
  port?: number | null
  runId: string
  instanceId?: string
  instanceExplicit?: boolean
}

export function detectLiveDevSessionOwner(
  readyPath: string,
  isAlive: (pid: number) => boolean = (pid) => {
    try {
      process.kill(pid, 0)

      return true
    } catch {
      return false
    }
  }
): LiveDevSessionOwner | null {
  try {
    if (!fs.existsSync(readyPath)) return null

    const prev = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    if (prev?.command !== 'dev') return null
    if (typeof prev.pid !== 'number' || prev.pid === process.pid) return null
    if (prev.status !== 'ready' && prev.status !== 'starting') return null
    if (!isAlive(prev.pid)) return null

    return {
      pid: prev.pid as number,
      port: typeof prev.port === 'number' ? prev.port : null,
      runId: typeof prev.runId === 'string' ? prev.runId : '',
      instanceId:
        typeof prev.instanceId === 'string' ? prev.instanceId : undefined,
      instanceExplicit: prev.instanceExplicit === true
    }
  } catch {
    return null
  }
}

// Every session gets an auto instance id, so id inequality means nothing.
// Silence needs both sides to have ASKED for distinct instances.
export function shouldWarnDevOverDev(
  owner: LiveDevSessionOwner,
  my: {instanceId?: string; instanceExplicit?: boolean}
): boolean {
  if (
    owner.instanceExplicit &&
    my.instanceExplicit &&
    owner.instanceId &&
    my.instanceId &&
    owner.instanceId !== my.instanceId
  ) {
    return false
  }

  return true
}

export function getPlaywrightMetadataDir(
  packageJsonDir: string,
  browser: string
): AbsolutePath {
  return asAbsolute(browserArtifactsDir(packageJsonDir, browser))
}

export function createPlaywrightMetadataWriter(options: WriterOptions) {
  const metadataDir = getPlaywrightMetadataDir(
    options.packageJsonDir,
    options.browser
  )
  const readyPath = asAbsolute(
    readyContractPath(options.packageJsonDir, options.browser)
  )
  const eventsPath = asAbsolute(
    sessionEventsPath(options.packageJsonDir, options.browser)
  )

  const toPort = (value: number | string | null | undefined): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value

    if (typeof value === 'string') {
      const parsed = parseInt(value, 10)

      return Number.isFinite(parsed) ? parsed : null
    }

    return null
  }

  const liveOwner = detectLiveDevSessionOwner(readyPath)

  // A second command against a project owned by a LIVE dev session must never
  // rewrite that session's contracts; detect the owner once and no-op writes.
  const foreignLiveDevSession =
    options.command !== 'dev' && liveOwner ? liveOwner : null

  if (foreignLiveDevSession) {
    console.warn(
      `[extension] a live dev session (pid ${foreignLiveDevSession.pid}) owns ` +
        `${readyPath}; this ${options.command} run will not rewrite the ` +
        `session's ready.json/events.ndjson. The output dir is shared, so ` +
        `the dev browser may pick up freshly ${options.command}-built files. ` +
        `Stop the dev session first for a clean ${options.command} receipt.`
    )
  }

  // A second dev session over the same target keeps going (distinct
  // --instance-id runs are a supported flow) but never silently.
  if (
    options.command === 'dev' &&
    liveOwner &&
    !devOverDevWarnedByMetadataDir.has(metadataDir) &&
    shouldWarnDevOverDev(liveOwner, {
      instanceId: options.instanceId,
      instanceExplicit: options.instanceExplicit
    })
  ) {
    devOverDevWarnedByMetadataDir.add(metadataDir)
    humanWarn(
      messages.anotherDevSessionActive(
        options.browser,
        liveOwner.pid,
        liveOwner.runId
      )
    )
  }

  const toManagedRecords = (
    dirs: string[] | undefined
  ): ManagedExtensionRecord[] | undefined =>
    Array.isArray(dirs) &&
    dirs.length > 0 &&
    !isEmulatorBrowser(options.browser)
      ? managedExtensionRecords(options.browser, dirs)
      : undefined

  // undefined = this writer never learned the list (preserve prev).
  // [] = the run said "none" and must wipe leftover companions.
  let managedExtensionsExplicit = options.managedExtensionDirs !== undefined
  let managedExtensions = toManagedRecords(options.managedExtensionDirs)

  let openedEpoch: number | null = null

  // Seeded from disk on first append: a restart reopens the run's events file,
  // so the budget counts what is already there, not only this writer's rows.
  let eventsBytes: number | null = null
  let eventsLines = 0

  const isSuperseded = () =>
    openedEpoch !== null &&
    writerEpochByMetadataDir.get(metadataDir) !== openedEpoch

  function readContract(): Record<string, unknown> | undefined {
    try {
      if (!fs.existsSync(readyPath)) return undefined

      return JSON.parse(fs.readFileSync(readyPath, 'utf-8')) as Record<
        string,
        unknown
      >
    } catch {
      return undefined
    }
  }

  const base = {
    schemaVersion: 2 as const,
    // Capability advertisement: a reader that sees this can trust the engine's
    // own status codes and stop falling back to scraping human output.
    schema: 1 as const,
    command: options.command,
    browser: options.browser,
    runId: getRunIdForSession(metadataDir),
    startedAt: nowISO(),
    distPath: options.distPath,
    manifestPath: options.manifestPath,
    port: toPort(options.port),
    host: options.host,
    instanceId: options.instanceId,
    ...(options.instanceExplicit ? {instanceExplicit: true} : {}),
    controlPort: toPort(options.controlPort),
    // On the writer's base rather than a one-shot write: the plugin's
    // writeStarting() replaces the document at the first compile.
    ...(options.controlPortUnavailableReason
      ? {
          controlPortUnavailableReason: String(
            options.controlPortUnavailableReason
          )
        }
      : {}),
    controlPath: options.controlPath,
    logsPath: options.logsPath,
    toolchainVersion: packageJson.version,
    ...readManifestProvenance(
      options.distPath
        ? path.join(options.distPath, 'manifest.json')
        : undefined,
      options.manifestPath
    ),
    ...(isEmulatorBrowser(options.browser)
      ? {engine: 'emulator' as const, browserPid: null}
      : {})
  }

  const ownsDocument = (prev: Record<string, unknown>) =>
    !isSuperseded() && prev.runId === base.runId

  function writeReady(
    status: ReadyStatus,
    extra?: {
      compiledAt?: string | null
      errors?: string[]
      code?: string
      message?: string
    }
  ) {
    if (foreignLiveDevSession || isSuperseded()) return

    ensureDirSync(metadataDir)

    const prev = readContract()

    const compiledAtExplicit = Boolean(extra && 'compiledAt' in extra)
    const compiledAt = compiledAtExplicit
      ? (extra?.compiledAt ?? null)
      : typeof prev?.compiledAt === 'string'
        ? prev.compiledAt
        : status === 'ready'
          ? nowISO()
          : null

    const payload: ReadyMetadata = {
      ...base,
      status,
      pid: process.pid,
      ts: nowISO(),
      compiledAt,
      errors: Array.isArray(extra?.errors) ? extra.errors : []
    }

    // A later writer in the same run (start's preview after the build, the
    // compiler a restart opens) keeps the run's original clock, not its own.
    if (
      prev &&
      prev.runId === base.runId &&
      typeof prev.startedAt === 'string'
    ) {
      payload.startedAt = prev.startedAt
    }

    if (extra?.code) payload.code = extra.code
    if (extra?.message) payload.message = extra.message

    if (managedExtensionsExplicit) {
      if (managedExtensions) payload.managedExtensions = managedExtensions
    } else if (
      Array.isArray(prev?.managedExtensions) &&
      (prev.managedExtensions as unknown[]).length > 0
    ) {
      payload.managedExtensions =
        prev.managedExtensions as ManagedExtensionRecord[]
    }

    const derivedExtensionId = deriveDistExtensionId(
      options.browser,
      options.distPath
    )
    if (derivedExtensionId) payload.extensionId = derivedExtensionId

    // Preserve fields the launcher wrote post-launch (cdpPort, browser exit
    // evidence): a recompile must not clobber them.
    //
    // Only within the SAME run. Every field below describes the browser this
    // run launched, and carrying them into the next run publishes a contract
    // that names a browser which no longer exists: a fresh runId with the
    // previous run's `browserPid`, its port, and its exit evidence. A consumer
    // cannot tell that apart from a live session, so it dials a dead process.
    // `startedAt` above already draws exactly this line.
    const sameRun = Boolean(prev && prev.runId === base.runId)

    if (prev && sameRun) {
      if (typeof prev.cdpPort === 'number') payload.cdpPort = prev.cdpPort
      if (typeof prev.rdpPort === 'number') payload.rdpPort = prev.rdpPort

      if (typeof prev.webdriverPort === 'number') {
        payload.webdriverPort = prev.webdriverPort
      }

      if (typeof prev.webdriverSessionId === 'string') {
        payload.webdriverSessionId = prev.webdriverSessionId
      }

      if (typeof prev.webdriverUnavailableReason === 'string') {
        payload.webdriverUnavailableReason = prev.webdriverUnavailableReason
      }

      if (typeof prev.profilePath === 'string') {
        payload.profilePath = prev.profilePath
      }

      if (typeof prev.browserPid === 'number') {
        payload.browserPid = prev.browserPid
      }

      if (typeof prev.launcherPid === 'number') {
        payload.launcherPid = prev.launcherPid
      }

      // Which binary actually launched, and how it was chosen. Stamped once at
      // launch and never recomputed, so without this a single recompile erased
      // it and `doctor` went back to being unable to say which browser is
      // running, the exact question it exists to answer.
      if (typeof prev.binary === 'string' && prev.binary) {
        ;(payload as Record<string, unknown>).binary = prev.binary
      }

      if (typeof prev.binaryProvenance === 'string' && prev.binaryProvenance) {
        ;(payload as Record<string, unknown>).binaryProvenance =
          prev.binaryProvenance
      }

      // The launcher's stamp may carry the browser-confirmed id, which
      // outranks the derived one, so the previous value wins on recompile.
      if (typeof prev.extensionId === 'string' && prev.extensionId) {
        payload.extensionId = prev.extensionId
      }

      if (typeof prev.browserExitedAt === 'string') {
        ;(payload as Record<string, unknown>).browserExitedAt =
          prev.browserExitedAt
        ;(payload as Record<string, unknown>).browserExitCode =
          prev.browserExitCode ?? null
        ;(payload as Record<string, unknown>).browserExitSignal =
          prev.browserExitSignal ?? null

        // A browser that left before anything loaded is not brought back by a
        // recompile, so the error it was stamped with outlives the compile.
        if (
          status === 'ready' &&
          prev.status === 'error' &&
          prev.code === 'browser_exited'
        ) {
          payload.status = 'error' as ReadyStatus
          payload.code = 'browser_exited'
          payload.message = String(prev.message || 'the browser exited')
        }
      }

      // A launch that never produced a browser is not retried by a recompile
      // either, so the failure it was stamped with outlives the compile too.
      if (typeof prev.browserLaunchFailedAt === 'string') {
        const target = payload as Record<string, unknown>
        target.browserLaunchFailedAt = prev.browserLaunchFailedAt

        if (typeof prev.browserLaunchFailedReason === 'string') {
          target.browserLaunchFailedReason = prev.browserLaunchFailedReason
        }

        if (typeof prev.browserLaunchFailedCode === 'string') {
          target.browserLaunchFailedCode = prev.browserLaunchFailedCode
        }

        if (
          status === 'ready' &&
          prev.status === 'error' &&
          prev.code === 'browser_launch_failed'
        ) {
          payload.status = 'error' as ReadyStatus
          payload.code = 'browser_launch_failed'
          payload.message = String(
            prev.message || 'the browser process could not start'
          )
        }
      }

      // The SW attaches once per session but the compile can re-run many
      // times; a recompile must not erase the runtime-attached signal.
      if (typeof prev.executorAttachedAt === 'string') {
        ;(payload as Record<string, unknown>).executorAttachedAt =
          prev.executorAttachedAt
        // A recompile must not resurrect a producer that has since gone away,
        // so the last known runtime state carries over rather than 'attached'.
        ;(payload as Record<string, unknown>).runtime =
          prev.runtime === 'detached' ? 'detached' : 'attached'

        if (typeof prev.executorDetachedAt === 'string') {
          ;(payload as Record<string, unknown>).executorDetachedAt =
            prev.executorDetachedAt
        }
      }

      // A browser-side load refusal outlives the compile that follows it: the
      // rebuild succeeding says nothing about the guest the browser threw out.
      // 'starting' is a new run, which re-asks the browser, so it resets.
      if (
        status !== 'starting' &&
        typeof prev.extensionLoadRefusedAt === 'string'
      ) {
        const target = payload as Record<string, unknown>
        target.extensionLoadRefusedAt = prev.extensionLoadRefusedAt

        if (typeof prev.extensionLoadRefusedReason === 'string') {
          target.extensionLoadRefusedReason = prev.extensionLoadRefusedReason
        }

        if (status === 'ready') {
          payload.status = 'error' as ReadyStatus
          payload.code = 'extension_load_refused'
          payload.message = String(
            prev.message || 'the browser refused to load the extension'
          )
        }
      }
    }

    writeJsonAtomic(readyPath, payload)
  }

  function appendEvent(event: PlaywrightAutomationEvent) {
    if (foreignLiveDevSession) return

    ensureDirSync(metadataDir)

    const line = `${JSON.stringify({
      ...capEventSize(event),
      runId: event.runId ?? base.runId
    })}\n`

    try {
      if (eventsBytes === null) {
        eventsBytes = fs.existsSync(eventsPath)
          ? fs.statSync(eventsPath).size
          : 0
      }

      fs.appendFileSync(eventsPath, line, 'utf-8')
      eventsBytes += Buffer.byteLength(line)
      eventsLines += 1
    } catch {
      return
    }

    if (eventsBytes >= MAX_EVENTS_BYTES || eventsLines >= MAX_EVENTS_LINES) {
      rotateEventsFile(eventsPath)
      eventsBytes = 0
      eventsLines = 0
    }
  }

  return {
    metadataDir,
    readyPath,
    eventsPath,
    setManagedExtensionDirs(dirs: string[]) {
      managedExtensionsExplicit = true
      managedExtensions = toManagedRecords(dirs)
    },
    isSuperseded,
    writeStarting() {
      if (foreignLiveDevSession) return

      openedEpoch = (writerEpochByMetadataDir.get(metadataDir) || 0) + 1
      writerEpochByMetadataDir.set(metadataDir, openedEpoch)
      ensureDirSync(metadataDir)

      // A new run resets the timeline so prior-run entries don't interleave;
      // a restart reopens the run on disk and keeps appending to it.
      if (readContract()?.runId !== base.runId) {
        try {
          fs.writeFileSync(eventsPath, '', 'utf-8')
          eventsBytes = 0
          eventsLines = 0
        } catch {
          // Ignore
        }
      }

      writeReady('starting', {compiledAt: null})
    },
    // A compile that a browser launch follows is not the session being ready,
    // so the receipt keeps starting and the launch phase stamps ready.
    writeCompiled(compiledAt: string) {
      writeReady('starting', {compiledAt})
    },
    writeReady(compiledAt?: string | null) {
      if (compiledAt === undefined) {
        writeReady('ready')
      } else {
        writeReady('ready', {compiledAt: compiledAt || nowISO()})
      }
    },
    writeError(code: string, message: string, errors?: string[]) {
      writeReady('error', {
        code,
        message,
        errors: Array.isArray(errors) ? errors : [],
        compiledAt: null
      })
    },
    // Stamp a terminal status at watch close so a controller can never read green
    // over a dead pid; read-modify-write keeps the session's provenance intact.
    writeShutdown(message = 'the dev session ended (watch closed)') {
      if (foreignLiveDevSession) return

      const prev = readContract()
      if (!prev || !ownsDocument(prev)) return

      prev.status = 'stopped'
      prev.code = 'shutdown'
      prev.message = message
      prev.ts = nowISO()

      try {
        writeJsonAtomic(readyPath, prev)
      } catch {
        // Ignore
      }
    },
    // The mirror of stampExecutorAttached: without it `runtime` was a latch that
    // said "attached" long after the last producer went away, so a reader could
    // not tell a live extension from a dead one.
    stampExecutorDetached() {
      const prev = readContract()
      if (!prev || !ownsDocument(prev)) return
      if (typeof prev.executorAttachedAt !== 'string') return

      prev.runtime = 'detached'
      prev.executorDetachedAt = nowISO()
      prev.ts = nowISO()

      try {
        writeJsonAtomic(readyPath, prev)
      } catch {
        // Ignore
      }
    },
    // Stamp the runtime-attached signal on first SW connect; read-modify-write and
    // idempotent so reconnects don't disturb status or launcher-stamped fields.
    stampExecutorAttached() {
      try {
        if (!fs.existsSync(readyPath)) return

        const prev = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
        prev.runtime = 'attached'
        delete prev.executorDetachedAt

        if (typeof prev.executorAttachedAt === 'string') {
          prev.ts = nowISO()
          writeJsonAtomic(readyPath, prev)

          return
        }

        prev.executorAttachedAt = nowISO()

        // The executor runs INSIDE the guest, so an attach is proof the browser
        // is running it. Any earlier refusal is stale however it got fixed -
        // a retry, or a human pressing Reload on the extensions page.
        if (typeof prev.extensionLoadRefusedAt === 'string') {
          delete prev.extensionLoadRefusedAt
          delete prev.extensionLoadRefusedReason

          if (prev.code === 'extension_load_refused') {
            prev.status = 'ready'
            delete prev.code
            delete prev.message
          }
        }

        prev.ts = nowISO()
        writeJsonAtomic(readyPath, prev)
      } catch {
        // Ignore
      }
    },
    appendEvent
  }
}

export class PlaywrightPlugin {
  public static readonly name = 'plugin-playwright'
  private readonly writer: ReturnType<typeof createPlaywrightMetadataWriter>
  private readonly command: PlaywrightAutomationCommand
  private readonly browser: string
  private readonly launchFollows: boolean

  constructor(options: PluginOptions) {
    this.browser = String(options.browser || 'chromium')
    this.command =
      options.command || (options.mode === 'development' ? 'dev' : 'start')

    this.launchFollows = options.launchFollows === true

    this.writer = createPlaywrightMetadataWriter({
      packageJsonDir: options.packageJsonDir,
      browser: this.browser,
      command: this.command,
      distPath: options.outputPath,
      manifestPath: options.manifestPath,
      port: options.port,
      host: options.host,
      instanceId: options.instanceId,
      instanceExplicit: options.instanceExplicit,
      controlPort: options.controlPort,
      controlPortUnavailableReason: options.controlPortUnavailableReason,
      controlPath: options.controlPath,
      logsPath: options.logsPath,
      managedExtensionDirs: options.managedExtensionDirs
    })
  }

  apply(compiler: Compiler) {
    this.writer.writeStarting()

    compiler.hooks.compile.tap(PlaywrightPlugin.name, () => {
      this.writer.appendEvent({
        type: 'compile_start',
        ts: nowISO(),
        command: this.command,
        browser: this.browser
      })
    })

    compiler.hooks.done.tap(PlaywrightPlugin.name, (stats) => {
      const durationMs = Number(
        (stats?.compilation?.endTime || 0) -
          (stats?.compilation?.startTime || 0)
      )
      const hasErrors = Boolean(stats?.hasErrors?.())
      const errorsJson = stats?.toJson?.({all: false, errors: true})
      const errorsCount = Array.isArray(errorsJson?.errors)
        ? errorsJson.errors.length
        : 0

      if (hasErrors) {
        const errorMessages = formatStatsErrors(errorsJson?.errors)
        const contractErrors = errorMessages.length
          ? errorMessages
          : [`errors: ${String(errorsCount || 1)}`]
        this.writer.appendEvent({
          type: 'compile_error',
          ts: nowISO(),
          command: this.command,
          browser: this.browser,
          durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
          errorCount: Number.isFinite(errorsCount) ? errorsCount : 1,
          errors: contractErrors
        })

        this.writer.writeError(
          'compile_error',
          'Compilation failed',
          contractErrors
        )

        return
      }

      this.writer.appendEvent({
        type: 'compile_success',
        ts: nowISO(),
        command: this.command,
        browser: this.browser,
        durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
        errorCount: 0
      })

      if (this.launchFollows) {
        this.writer.writeCompiled(nowISO())
      } else {
        this.writer.writeReady(nowISO())
      }
    })

    compiler.hooks.failed.tap(PlaywrightPlugin.name, (error: unknown) => {
      this.writer.appendEvent({
        type: 'compile_error',
        ts: nowISO(),
        command: this.command,
        browser: this.browser,
        errorCount: 1
      })

      this.writer.writeError(
        'compile_failed',
        error instanceof Error ? error.message : String(error)
      )
    })

    compiler.hooks.watchClose.tap(PlaywrightPlugin.name, () => {
      // A restart closes this watch after the next compiler opened the run;
      // the session is alive, so neither the event nor the stamp is its end.
      if (this.writer.isSuperseded()) return

      this.writer.appendEvent({
        type: 'shutdown',
        ts: nowISO(),
        command: this.command,
        browser: this.browser
      })

      // The event alone leaves ready.json advertising "ready" for a dying pid. Dev
      // only: a completed start run's ready.json is a receipt and must stay "ready".
      if (this.command === 'dev') this.writer.writeShutdown()
    })
  }
}
