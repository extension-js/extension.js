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
  isChromiumBasedBrowser,
  isEmulatorBrowser,
  isGeckoBasedBrowser,
  isWebkitBasedBrowser
} from '../lib/constants'
import {
  type DevAddition,
  devAdditionsOf,
  mergeDevAdditions
} from '../lib/dev-additions'
import {
  chromiumExtensionId,
  geckoExtensionId,
  type ManagedExtensionRecord,
  managedExtensionRecords
} from '../lib/extension-id'
import {isSessionPidLive, type SessionPidProbes} from '../lib/live-dev-session'
import * as messages from '../lib/messages'
import {humanWarn} from '../lib/messaging'
import {parseJsonSafe} from '../lib/parse-json-safe'
import {type AbsolutePath, asAbsolute} from '../lib/paths'
import {ownProcessStartedAt, ownProcessStartId} from '../lib/process-started-at'
import {renameSyncWithRetry} from '../lib/rename-with-retry'
import {
  browserArtifactsDir,
  type OwedDebuggerPorts,
  owedPortsSettled,
  readyContractPath,
  releaseHeldReady as releaseHeld
} from '../lib/session-contract'
import {eventsPath as sessionEventsPath} from '../lib/session-paths'
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
  // When the process behind `pid` started (ISO 8601 UTC). A pid is reused
  // once its owner exits, so a reader that finds `pid` alive checks this
  // against the process table before trusting it.
  pidStartedAt: string
  // Linux only: the boot id and the kernel's start tick of `pid`, which name
  // one process exactly and do not move when the wall clock is stepped.
  pidStartId?: string
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
  // Why rdpPort is absent: Firefox never opened the port, left first, or a dry
  // run launched nothing. A ready Gecko dev contract carries one of the two.
  rdpPortError?: string
  // Safari dev sessions only: the safaridriver session the launcher holds
  // beside the app, or why it holds none. Stamped post-launch.
  webdriverPort?: number
  webdriverSessionId?: string
  webdriverUnavailableReason?: string
  webdriverRequestPath?: string
  // Safari dev sessions only: how far the enable step got (the switch in
  // Safari Settings) and why it stopped, stamped by the launcher post-launch.
  safari?: {
    bundleId: string
    extensionId: string
    team: string
    switchId: string
    enableAttempted: boolean
    step: string
    enabled: boolean | null
    listed: boolean | null
    otherWebsites: string | null
    reason?: string
    earlierExtensionIds?: string[]
  }
  // Dev only: the last reload dev applied after a compile, its kind (full,
  // background, content, page, safari-resync) and the shared reload label.
  reloadedAt?: string
  reloadKind?: string
  reloadLabel?: string
  // Stamped by the browser launcher post-launch: the resolved profile dir (an
  // ephemeral profile's leaf name is generated) and the browser process pid.
  profilePath?: string
  browserPid?: number | null
  // When the browser process started, read off the process table beside its
  // pid the way `pidStartedAt` is; the launcher pid below gets the same.
  browserStartedAt?: string
  engine?: 'emulator'
  // The pid the launcher spawned, kept once the browser handed the session to
  // another process; browserPid then names that live process.
  launcherPid?: number
  launcherStartedAt?: string
  // Provenance: which toolchain produced this tree, for which extension;
  // ready.json doubles as a build receipt for one-shot builds.
  toolchainVersion: string
  extensionName?: string
  extensionVersion?: string
  // The id the browser serves the dist under: browser-confirmed when the
  // launcher stamped it, otherwise derived the way the browser derives it.
  extensionId?: string
  extensionIdSource?: ExtensionIdSource
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
  // Stamped when the session ended as failed or usage, so the watch close
  // keeps the error that ended it instead of a clean stop.
  endedAsFailedAt?: string
  endedAsFailedCode?: string
  // Stamped by the Chromium launcher when the CDP wire failed after launch:
  // the session stays ready and names the fault. Preserved across recompiles.
  cdpFaultCode?: string
  cdpFaultMessage?: string
  // Runtime attachment signal: 'ready' means compiled; these mean the SW has
  // connected and can be driven. Act-tooling should wait for runtime:'attached'.
  runtime?: 'attached' | 'detached'
  executorAttachedAt?: string
  extensionBaseUrl?: string
  // Every extension the engine loads besides the user's (built-in companions
  // plus --extensions dirs), so a target census can subtract them by id.
  managedExtensions?: ManagedExtensionRecord[]
  // Dev sessions only: every grant and browser flag the session has that the
  // production build of the same source does not, each with its reason.
  devAdditions?: DevAddition[]
}

export type PlaywrightAutomationEvent = {
  type:
    | 'compile_start'
    | 'compile_success'
    | 'compile_error'
    | 'shutdown'
    | 'browser_exited'
    | 'browser_launch_failed'
    | 'restart_failed'
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
  // restart_failed: the code of what stopped the restart, with `reason`, and
  // whether the build from before it still serves the session.
  code?: string
  serving?: boolean
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
  // A Gecko dev session with a launch ahead: ready waits for the launcher to
  // stamp the RDP port, or the reason Firefox has none.
  readyAwaitsRdpPort?: boolean
  // A dev session that takes act verbs, with a launch ahead: ready waits a
  // bounded time for the background's first hello.
  readyAwaitsExecutor?: boolean
  // A Chromium dev session with a launch ahead: ready waits for the launcher
  // to stamp the browser and its CDP port, or to say the launch is over.
  readyAwaitsCdpPort?: boolean
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
  readyAwaitsRdpPort?: boolean
  readyAwaitsExecutor?: boolean
  readyAwaitsCdpPort?: boolean
}

// How long a held ready waits for the first hello. An extension that never
// connects still gets its ready, with no attach stamp on it.
export const READY_EXECUTOR_WAIT_MS = 10000

function nowISO() {
  return new Date().toISOString()
}

const MAX_CONTRACT_ERRORS = 10

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g

// ready.json and events.ndjson are machine contracts (--wait, doctor, logs,
// MCP), so error text is plain and no consumer has to strip color.
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
        renameSyncWithRetry(from, rotatedEventsName(eventsPath, n + 1))
      }
    }

    if (fs.existsSync(eventsPath)) {
      renameSyncWithRetry(eventsPath, rotatedEventsName(eventsPath, 1))
    }
  } catch {
    // Ignore
  }
}

// What names the row. Never trimmed, and short by construction.
const EVENT_IDENTITY_FIELDS = new Set([
  'type',
  'ts',
  'command',
  'browser',
  'runId',
  'code'
])

function fitsEventCap(event: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(event)) <= MAX_EVENT_BYTES
}

// A diagnostic-heavy failure writes one enormous line, so the TEXT is trimmed
// (every error and every other string field) rather than the JSON, which
// every consumer still has to parse.
function capEventSize(
  event: PlaywrightAutomationEvent
): PlaywrightAutomationEvent {
  if (fitsEventCap(event)) return event

  const source = event as Record<string, unknown>
  const textFields = Object.keys(source).filter(
    (key) => !EVENT_IDENTITY_FIELDS.has(key) && typeof source[key] === 'string'
  )
  const errors = Array.isArray(event.errors) ? event.errors : undefined
  const perText = Math.floor(
    MAX_EVENT_BYTES / 2 / Math.max(1, textFields.length + (errors?.length ?? 0))
  )
  const trimmed: Record<string, unknown> = {...source, truncated: true}

  for (const key of textFields) {
    trimmed[key] = String(source[key]).slice(0, perText)
  }

  if (errors) {
    trimmed.errors = errors.map((message) => String(message).slice(0, perText))
  }

  if (fitsEventCap(trimmed)) return trimmed as PlaywrightAutomationEvent

  // Too many errors, or text that grows when escaped: the counts survive.
  for (const key of textFields) trimmed[key] = ''
  if (errors) trimmed.errors = []

  return trimmed as PlaywrightAutomationEvent
}

// The verdicts a compile writes. A later compile that succeeds clears these
// and no other error: the rest describe a browser a rebuild does not bring back.
export const COMPILE_VERDICTS: ReadonlySet<string> = new Set([
  'compile_error',
  'compile_failed'
])

// What the engine writer computes on every write. Any other field on a
// same-run record was stamped beside it and carries across a recompile.
const WRITER_FIELDS: ReadonlySet<string> = new Set<
  keyof ReadyMetadata | 'awaitingExecutorSince'
>([
  'schemaVersion',
  'schema',
  'status',
  'command',
  'browser',
  'runId',
  'startedAt',
  'distPath',
  'manifestPath',
  'port',
  'host',
  'pid',
  'pidStartedAt',
  'pidStartId',
  'ts',
  'compiledAt',
  'errors',
  'code',
  'message',
  'instanceId',
  'instanceExplicit',
  'controlPort',
  'controlPortUnavailableReason',
  'controlPath',
  'logsPath',
  'toolchainVersion',
  'extensionName',
  'extensionVersion',
  'engine',
  'managedExtensions',
  'devAdditions',
  'extensionId',
  'extensionIdSource',
  'awaitingExecutorSince'
])

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

// What a restart's next compiler replaced when it opened the same run: the
// serving writer's epoch and the document as that writer left it.
const takeoverByMetadataDir = new Map<
  string,
  {epoch: number | undefined; document: Record<string, unknown>}
>()

// A restart's next compiler takes the contract as it is built. When the rest
// of that bundle fails, the compiler that keeps serving gets both back.
export function holdServingContract(readyPath: string): () => void {
  const metadataDir = path.dirname(asAbsolute(readyPath))

  takeoverByMetadataDir.delete(metadataDir)

  return () => {
    const taken = takeoverByMetadataDir.get(metadataDir)
    if (!taken) return

    takeoverByMetadataDir.delete(metadataDir)

    if (taken.epoch === undefined) {
      writerEpochByMetadataDir.delete(metadataDir)
    } else {
      writerEpochByMetadataDir.set(metadataDir, taken.epoch)
    }

    writeContractFile(asAbsolute(readyPath), taken.document)
  }
}

// The runs whose launcher came back, by contract path and run. A session
// holds two writers, and the one that compiles has to hear the other.
const settledLaunches = new Set<string>()

// The dev server and its compiler plugin each open a writer on the same run,
// so the other session is noticed twice and told of once.
const devOverDevWarnedByMetadataDir = new Set<string>()

// A host that outlives a session starts the next one in the same process,
// and that one is a new run: its own id, its own launch, its own notices.
export function forgetSessionRun(packageJsonDir: string, browser: string) {
  const metadataDir = getPlaywrightMetadataDir(packageJsonDir, browser)
  const readyPath = asAbsolute(readyContractPath(packageJsonDir, browser))

  runIdByMetadataDir.delete(metadataDir)
  devOverDevWarnedByMetadataDir.delete(metadataDir)

  for (const launchKey of settledLaunches) {
    if (launchKey.startsWith(`${readyPath}\n`)) {
      settledLaunches.delete(launchKey)
    }
  }
}

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

// Where the published id came from. Only a derived id is ever recomputed: the
// browser's own answer and the packager's bundle id describe what really runs.
export type ExtensionIdSource = 'browser' | 'derived' | 'packager'

function stampReadyExtensionIdFrom(
  packageJsonDir: string,
  browser: string,
  extensionId: string,
  source: Exclude<ExtensionIdSource, 'browser'>
): void {
  const readyPath = readyContractPath(packageJsonDir, browser)
  const prev = readJsonRecord(readyPath)
  if (!prev) return

  const prevIsAnswer =
    prev.extensionIdSource === 'browser' ||
    prev.extensionIdSource === 'packager'

  if (prev.extensionId && prevIsAnswer) return

  if (prev.extensionId === extensionId && prev.extensionIdSource === source) {
    return
  }

  prev.extensionId = extensionId
  prev.extensionIdSource = source
  writeContractFile(readyPath, prev)
}

// One-shot builds stamp ready.json at compile done, before the staging dist
// is promoted, so the id read then comes from the previous build or from no
// dist at all. The build command calls this after the promote to correct it.
export function stampReadyDistExtensionId(
  packageJsonDir: string,
  browser: string,
  distPath: string
): void {
  const derived = deriveDistExtensionId(browser, distPath)
  if (!derived) return

  stampReadyExtensionIdFrom(packageJsonDir, browser, derived, 'derived')
}

// Safari's identity cannot be derived from the dist: the packager resolves
// the appex bundle id, and the build command backfills that known value here.
export function stampReadyKnownExtensionId(
  packageJsonDir: string,
  browser: string,
  extensionId: string
): void {
  if (!extensionId) return

  stampReadyExtensionIdFrom(packageJsonDir, browser, extensionId, 'packager')
}

// Which manifest names the run. A dev session and a preview load the dist as it
// is, so a stale dist is reported as what the browser took, not as the unbuilt
// source. A one-shot compile (build, start) writes to a staging folder and
// promotes it after this writer opens, so the dist on disk at that moment is
// the previous build's; the source manifest is what the compile is turning
// into the product, and its name and version are the ones the receipt owes.
function manifestProvenanceCandidates(
  command: PlaywrightAutomationCommand,
  distPath: string | undefined,
  manifestPath: string | undefined
): Array<string | undefined> {
  const distManifest = distPath
    ? path.join(distPath, 'manifest.json')
    : undefined

  return command === 'dev' || command === 'preview'
    ? [distManifest, manifestPath]
    : [manifestPath, distManifest]
}

// Candidates in preference order, see manifestProvenanceCandidates.
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

// The object a contract file holds, or undefined when it is missing or is
// not one: a half-written file is read as no record.
function readJsonRecord(filePath: string): Record<string, unknown> | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined

    const value = JSON.parse(fs.readFileSync(filePath, 'utf-8'))

    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

// Answers the error a failed write threw, or undefined once it is in place.
function writeJsonAtomic(filePath: string, value: unknown): Error | undefined {
  const tmpPath = `${filePath}.tmp-${process.pid}`

  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
    renameSyncWithRetry(tmpPath, filePath)

    return undefined
  } catch (error) {
    try {
      fs.rmSync(tmpPath, {force: true})
    } catch {
      // The write failed already, and that is the error worth reporting.
    }

    return error instanceof Error ? error : new Error(String(error))
  }
}

// Contract files whose last write failed and was reported. A file is named
// once per failure streak, so a broken dist does not warn on every compile.
const unwritableContractFiles = new Set<string>()

function noteContractWrite(filePath: string, error: Error | undefined) {
  if (!error) {
    unwritableContractFiles.delete(filePath)

    return
  }

  if (unwritableContractFiles.has(filePath)) return

  unwritableContractFiles.add(filePath)

  const reason = (error as NodeJS.ErrnoException).code || error.message
  humanWarn(messages.sessionContractUnwritable(filePath, String(reason)))
}

function writeContractFile(filePath: string, value: unknown) {
  noteContractWrite(filePath, writeJsonAtomic(filePath, value))
}

export function safariExtensionBase(origin: unknown): string | null {
  const found = /^safari-web-extension:\/\/([0-9A-Za-z-]{8,64})\/?$/.exec(
    String(origin || '')
  )

  return found ? `safari-web-extension://${found[1]}/` : null
}

export interface LiveDevSessionOwner {
  pid: number
  port?: number | null
  runId: string
  instanceId?: string
  instanceExplicit?: boolean
  distPath?: string
}

// The live dev session a contract names. A reused pid is no owner: the pid
// must be alive and have started when the contract says its writer did.
export function detectLiveDevSessionOwner(
  readyPath: string,
  isAlive?: SessionPidProbes['isAlive'],
  startedAtOf?: SessionPidProbes['startedAtOf']
): LiveDevSessionOwner | null {
  const prev = readJsonRecord(readyPath)

  if (prev?.command !== 'dev') return null
  if (typeof prev.pid !== 'number' || prev.pid === process.pid) return null
  if (prev.status !== 'ready' && prev.status !== 'starting') return null
  if (!isSessionPidLive(prev, {isAlive, startedAtOf})) return null

  return {
    pid: prev.pid,
    port: typeof prev.port === 'number' ? prev.port : null,
    runId: typeof prev.runId === 'string' ? prev.runId : '',
    instanceId:
      typeof prev.instanceId === 'string' ? prev.instanceId : undefined,
    instanceExplicit: prev.instanceExplicit === true,
    ...(typeof prev.distPath === 'string' && prev.distPath
      ? {distPath: prev.distPath}
      : {})
  }
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

  // A build sent elsewhere with --out-dir shares nothing with the session,
  // so only a run into the session's own folder earns the notice.
  const sharesSessionOutput =
    !foreignLiveDevSession?.distPath ||
    path.resolve(foreignLiveDevSession.distPath) ===
      path.resolve(options.distPath)

  if (foreignLiveDevSession && sharesSessionOutput) {
    humanWarn(
      messages.liveDevSessionOwnsContract(
        options.command,
        foreignLiveDevSession.pid,
        readyPath
      )
    )
  }

  // The dev server refuses a second session over a live one, so two writers
  // meet here only when both started at once. Say so, and once.
  if (
    options.command === 'dev' &&
    liveOwner &&
    !devOverDevWarnedByMetadataDir.has(metadataDir)
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

  // undefined = no compile of this writer patched a dev manifest yet.
  let compiledDevAdditions: DevAddition[] | undefined

  let openedEpoch: number | null = null

  // Seeded from disk on first append: a restart reopens the run's events file,
  // so the budget counts what is already there, not only this writer's rows.
  let eventsBytes: number | null = null
  let eventsLines = 0

  const isSuperseded = () =>
    openedEpoch !== null &&
    writerEpochByMetadataDir.get(metadataDir) !== openedEpoch

  const readContract = () => readJsonRecord(readyPath)
  const writeContract = (value: unknown) => writeContractFile(readyPath, value)

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
      ...manifestProvenanceCandidates(
        options.command,
        options.distPath,
        options.manifestPath
      )
    ),
    ...(isEmulatorBrowser(options.browser)
      ? {engine: 'emulator' as const, browserPid: null}
      : {})
  }

  const ownsDocument = (prev: Record<string, unknown>) =>
    !isSuperseded() && prev.runId === base.runId

  const awaitsExecutor =
    options.readyAwaitsExecutor === true &&
    options.command === 'dev' &&
    !isWebkitBasedBrowser(options.browser) &&
    !isEmulatorBrowser(options.browser)

  let executorWaitOver = false
  let executorWaitTimer: ReturnType<typeof setTimeout> | undefined

  const awaitsRdpPort =
    options.readyAwaitsRdpPort === true &&
    options.command === 'dev' &&
    isGeckoBasedBrowser(options.browser)

  const awaitsCdpPort =
    options.readyAwaitsCdpPort === true &&
    options.command === 'dev' &&
    isChromiumBasedBrowser(options.browser) &&
    !isEmulatorBrowser(options.browser)

  const launchKey = `${readyPath}\n${base.runId}`

  // What the launcher still owes this session, with its own word that
  // nothing more is coming standing in for a CDP port.
  const owedPorts = (): OwedDebuggerPorts => ({
    rdpPort: awaitsRdpPort,
    cdpPort: awaitsCdpPort,
    launchSettled: settledLaunches.has(launchKey)
  })

  // The wait ran out with nothing connected, so the compile goes ready the
  // way it did before and a reader finds no attach stamp beside it.
  function releaseHeldReady() {
    executorWaitOver = true

    const prev = readContract()
    if (!prev || !ownsDocument(prev)) return
    if (typeof prev.awaitingExecutorSince !== 'string') return

    delete prev.awaitingExecutorSince
    if (releaseHeld(prev, owedPorts())) prev.ts = nowISO()

    writeContract(prev)
  }

  // A session that ended waits for no hello, and its timer must not rewrite
  // the record the end just stamped.
  function stopExecutorWait() {
    executorWaitOver = true

    if (executorWaitTimer) {
      clearTimeout(executorWaitTimer)
      executorWaitTimer = undefined
    }
  }

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
      pidStartedAt: ownProcessStartedAt(),
      ...(ownProcessStartId() ? {pidStartId: ownProcessStartId()} : {}),
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

    if (derivedExtensionId) {
      payload.extensionId = derivedExtensionId
      payload.extensionIdSource = 'derived'
    }

    // Facts stamped beside the status (the launcher's browser, ports, exit
    // evidence, the runtime attach) outlive a recompile, every one of them,
    // so a fact the launcher learns to stamp later needs no change here.
    //
    // Only within the SAME run. Every such fact describes the browser this
    // run launched, and carrying them into the next run publishes a contract
    // that names a browser which no longer exists: a fresh runId with the
    // previous run's `browserPid`, its port, and its exit evidence. A consumer
    // cannot tell that apart from a live session, so it dials a dead process.
    // `startedAt` above already draws exactly this line.
    const sameRun = Boolean(prev && prev.runId === base.runId)

    const devAdditions = mergeDevAdditions(
      compiledDevAdditions,
      sameRun ? prev?.devAdditions : undefined
    )

    if (devAdditions) payload.devAdditions = devAdditions

    if (prev && sameRun) {
      const target = payload as Record<string, unknown>

      for (const [field, value] of Object.entries(prev)) {
        if (WRITER_FIELDS.has(field) || field in target) continue

        target[field] = value
      }

      // A browser-confirmed id outranks the derivation, so it survives a
      // recompile. A derived one is recomputed, since the key may have moved.
      if (
        typeof prev.extensionId === 'string' &&
        prev.extensionId &&
        (prev.extensionIdSource === 'browser' ||
          prev.extensionIdSource === 'packager')
      ) {
        payload.extensionId = prev.extensionId
        payload.extensionIdSource = prev.extensionIdSource
      }

      // The launcher's "browser is up, nothing attached" note describes one
      // wait: a new start re-asks, and an attach has already answered it.
      if (
        status === 'starting' ||
        typeof prev.executorAttachedAt === 'string'
      ) {
        delete target.browserUpNotAttachedAt
        delete target.browserUpNotAttachedWaitMs
        delete target.browserUpNotAttachedHint
      }

      // A browser-side load refusal outlives the compile that follows it: the
      // rebuild succeeding says nothing about the guest the browser threw out.
      // 'starting' is a new run, which re-asks the browser, so it resets.
      if (status === 'starting') {
        delete target.extensionLoadRefusedAt
        delete target.extensionLoadRefusedReason
        delete target.extensionLoadRefusedCause
      } else if (
        typeof prev.extensionLoadRefusedAt === 'string' &&
        payload.extensionIdSource === 'derived'
      ) {
        // The refused extension holds no id, so the forecast stays out.
        delete payload.extensionId
        delete payload.extensionIdSource
      }

      // A compile clears only a compile's verdict. Any other error on this
      // run (the browser exited, never launched, found its profile locked,
      // refused the extension) is not undone by a rebuild, so it stands.
      if (
        status === 'ready' &&
        prev.status === 'error' &&
        typeof prev.code === 'string' &&
        prev.code &&
        !COMPILE_VERDICTS.has(prev.code)
      ) {
        payload.status = 'error'
        payload.code = prev.code

        if (typeof prev.message === 'string') payload.message = prev.message
      } else if (
        status === 'ready' &&
        typeof prev.extensionLoadRefusedAt === 'string'
      ) {
        payload.status = 'error'
        payload.code = 'extension_load_refused'
        payload.message = String(
          prev.message || 'the browser refused to load the extension'
        )
      }
    }

    // The browser opens after the compile and its background dials in after
    // that, so a reader who acts on ready would find nothing to act through.
    const executorSettled =
      sameRun && typeof prev?.executorAttachedAt === 'string'

    if (
      payload.status === 'ready' &&
      awaitsExecutor &&
      !executorWaitOver &&
      !executorSettled
    ) {
      payload.status = 'starting'
      ;(payload as Record<string, unknown>).awaitingExecutorSince =
        typeof prev?.awaitingExecutorSince === 'string' && sameRun
          ? prev.awaitingExecutorSince
          : nowISO()

      if (!executorWaitTimer) {
        executorWaitTimer = setTimeout(releaseHeldReady, READY_EXECUTOR_WAIT_MS)
        executorWaitTimer.unref?.()
      }
    }

    // A dev compile ends before the launcher has a browser, so a reader who
    // took ready here would find no pid, binary or debugger port to use.
    if (
      payload.status === 'ready' &&
      !owedPortsSettled(sameRun ? prev : undefined, owedPorts())
    ) {
      payload.status = 'starting'
    }

    writeContract(payload)
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
      noteContractWrite(eventsPath, undefined)
    } catch (error) {
      noteContractWrite(eventsPath, error as Error)

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
    setDevAdditions(additions: DevAddition[]) {
      compiledDevAdditions = additions
    },
    isSuperseded,
    writeStarting() {
      if (foreignLiveDevSession) return

      const replaced = readContract()
      const servingEpoch = writerEpochByMetadataDir.get(metadataDir)

      if (replaced?.runId === base.runId) {
        takeoverByMetadataDir.set(metadataDir, {
          epoch: servingEpoch,
          document: replaced
        })
      }

      openedEpoch = (servingEpoch || 0) + 1
      writerEpochByMetadataDir.set(metadataDir, openedEpoch)
      ensureDirSync(metadataDir)

      // A new run resets the timeline so prior-run entries don't interleave;
      // a restart reopens the run on disk and keeps appending to it.
      if (replaced?.runId !== base.runId) {
        try {
          fs.writeFileSync(eventsPath, '', 'utf-8')
          eventsBytes = 0
          eventsLines = 0
          noteContractWrite(eventsPath, undefined)
        } catch (error) {
          noteContractWrite(eventsPath, error as Error)
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
    // A session that ended as failed or usage reads error from then on. One
    // already in error keeps the code that ended it, which --wait reads.
    writeEndedAsFailed(errorCode: string, message: string) {
      if (foreignLiveDevSession) return

      const prev = readContract()
      if (!prev || !ownsDocument(prev)) return

      stopExecutorWait()

      if (prev.status !== 'error') {
        prev.status = 'error'
        prev.code = 'shutdown'
        prev.message = message
      }

      prev.endedAsFailedAt = nowISO()
      prev.endedAsFailedCode = errorCode
      prev.ts = nowISO()

      writeContract(prev)
    },
    // Stamp a terminal status at watch close so a controller can never read green
    // over a dead pid; read-modify-write keeps the session's provenance intact.
    writeShutdown(message = 'the dev session ended (watch closed)') {
      if (foreignLiveDevSession) return

      const prev = readContract()
      if (!prev || !ownsDocument(prev)) return
      if (typeof prev.endedAsFailedAt === 'string') return

      stopExecutorWait()

      prev.status = 'stopped'
      prev.code = 'shutdown'
      prev.message = message
      prev.ts = nowISO()

      writeContract(prev)
    },
    // A reload dev applied after a compile. A tool waiting for the rebuild to
    // be live compares reloadedAt with compiledAt instead of guessing from a
    // background reconnect, which a content, page or Safari reload never does.
    stampReload(kind: string, label?: string) {
      const prev = readContract()
      if (!prev || !ownsDocument(prev)) return

      prev.reloadedAt = nowISO()
      prev.reloadKind = kind

      if (label) prev.reloadLabel = label
      else delete prev.reloadLabel

      writeContract(prev)
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

      writeContract(prev)
    },
    // The launcher came back, with a browser or without one, so a compile
    // held for what it stamps goes ready with whatever the launch left.
    settleBrowserLaunch() {
      settledLaunches.add(launchKey)

      const prev = readContract()
      if (!prev || prev.runId !== base.runId) return
      if (typeof prev.awaitingExecutorSince === 'string') return
      if (!releaseHeld(prev, owedPorts())) return

      prev.ts = nowISO()

      writeContract(prev)
    },
    // Stamp the runtime-attached signal on every connect. The first one also
    // releases a held ready and clears a load refusal the attach disproves.
    stampExecutorAttached(attached?: {origin?: string}) {
      const prev = readContract()
      if (!prev || !ownsDocument(prev)) return

      prev.runtime = 'attached'
      delete prev.executorDetachedAt

      const extensionBase = safariExtensionBase(attached?.origin)
      if (extensionBase) prev.extensionBaseUrl = extensionBase

      if (typeof prev.executorAttachedAt === 'string') {
        writeContract(prev)

        return
      }

      prev.executorAttachedAt = nowISO()

      // The hello is what a held compile was waiting for.
      let statusChanged = false

      if (typeof prev.awaitingExecutorSince === 'string') {
        delete prev.awaitingExecutorSince
        statusChanged = releaseHeld(prev, owedPorts())
      }

      // The launcher's "browser is up, nothing attached" note describes the
      // wait that just ended, so the attach takes it off the contract.
      delete prev.browserUpNotAttachedAt
      delete prev.browserUpNotAttachedWaitMs
      delete prev.browserUpNotAttachedHint

      // The executor runs INSIDE the guest, so an attach is proof the browser
      // is running it. Any earlier refusal is stale however it got fixed:
      // a retry, or a human pressing Reload on the extensions page.
      if (typeof prev.extensionLoadRefusedAt === 'string') {
        delete prev.extensionLoadRefusedAt
        delete prev.extensionLoadRefusedReason
        delete prev.extensionLoadRefusedCause

        if (prev.code === 'extension_load_refused') {
          prev.status = 'ready'
          delete prev.code
          delete prev.message
          statusChanged = true
        }
      }

      if (statusChanged) prev.ts = nowISO()

      writeContract(prev)
    },
    appendEvent,
    // A dev restart that could not be made, beside the compiles around it.
    writeRestartFailed(args: {
      code: string
      message: string
      serving: boolean
    }) {
      appendEvent({
        type: 'restart_failed',
        ts: nowISO(),
        command: base.command,
        browser: base.browser,
        code: args.code,
        reason: args.message,
        serving: args.serving
      })
    }
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
      managedExtensionDirs: options.managedExtensionDirs,
      readyAwaitsRdpPort: options.readyAwaitsRdpPort === true,
      readyAwaitsExecutor: options.readyAwaitsExecutor === true,
      readyAwaitsCdpPort: options.readyAwaitsCdpPort === true
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

      const devAdditions = devAdditionsOf(stats?.compilation)
      if (devAdditions) this.writer.setDevAdditions(devAdditions)

      if (this.launchFollows) {
        this.writer.writeCompiled(nowISO())
      } else {
        this.writer.writeReady(nowISO())
      }
    })

    // The same plain text the done path writes, so a contract reader finds
    // the failure in `errors` and never has to strip color from `message`.
    compiler.hooks.failed.tap(PlaywrightPlugin.name, (error: unknown) => {
      const errors = formatStatsErrors([error])
      const contractErrors = errors.length ? errors : ['Compilation failed']

      this.writer.appendEvent({
        type: 'compile_error',
        ts: nowISO(),
        command: this.command,
        browser: this.browser,
        errorCount: 1,
        errors: contractErrors
      })

      this.writer.writeError(
        'compile_failed',
        contractErrors[0],
        contractErrors
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
