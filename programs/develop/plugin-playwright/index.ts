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
import {isGeckoBasedBrowser} from '../lib/constants'
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
  controlPath?: string
  logsPath?: string
  cdpPort?: number
  // Gecko launches only: the RDP debugger-server port, stamped by the Firefox
  // launcher post-launch (the CDP-extras pairing seam for downstream tooling).
  rdpPort?: number
  // Stamped by the browser launcher post-launch: the resolved profile dir (an
  // ephemeral profile's leaf name is generated) and the browser process pid.
  profilePath?: string
  browserPid?: number
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
  // Runtime attachment signal: 'ready' means compiled; these mean the SW has
  // connected and can be driven. Act-tooling should wait for runtime:'attached'.
  runtime?: 'attached'
  executorAttachedAt?: string
  // Every extension the engine loads besides the user's (built-in companions
  // plus --extensions dirs), so a target census can subtract them by id.
  managedExtensions?: ManagedExtensionRecord[]
}

export type PlaywrightAutomationEvent = {
  type: 'compile_start' | 'compile_success' | 'compile_error' | 'shutdown'
  ts: string
  command: PlaywrightAutomationCommand
  browser: string
  runId?: string
  durationMs?: number
  errorCount?: number
  errors?: string[]
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
  controlPath?: string
  logsPath?: string
  managedExtensionDirs?: string[]
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

// The one identifier a consumer cannot read from the manifest alone: gecko
// declares it, chromium hashes the manifest key or the loaded dist path.
function deriveDistExtensionId(
  browser: string,
  distPath: string
): string | undefined {
  try {
    if (!fs.existsSync(path.join(distPath, 'manifest.json'))) return undefined
    const id = isGeckoBasedBrowser(browser)
      ? geckoExtensionId(distPath)
      : chromiumExtensionId(distPath)
    return id || undefined
  } catch {
    return undefined
  }
}

function readManifestProvenance(manifestPath: string): {
  extensionName?: string
  extensionVersion?: string
} {
  try {
    const manifest = parseJsonSafe(fs.readFileSync(manifestPath, 'utf-8'))
    return {
      extensionName:
        typeof manifest?.name === 'string' ? manifest.name : undefined,
      extensionVersion:
        typeof manifest?.version === 'string' ? manifest.version : undefined
    }
  } catch {
    return {}
  }
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
    shouldWarnDevOverDev(liveOwner, {
      instanceId: options.instanceId,
      instanceExplicit: options.instanceExplicit
    })
  ) {
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
    Array.isArray(dirs) && dirs.length > 0
      ? managedExtensionRecords(options.browser, dirs)
      : undefined

  let managedExtensions = toManagedRecords(options.managedExtensionDirs)

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
    controlPath: options.controlPath,
    logsPath: options.logsPath,
    toolchainVersion: packageJson.version,
    ...readManifestProvenance(options.manifestPath)
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
    if (foreignLiveDevSession) return
    ensureDirSync(metadataDir)
    const payload: ReadyMetadata = {
      ...base,
      status,
      pid: process.pid,
      ts: nowISO(),
      compiledAt: extra?.compiledAt ?? null,
      errors: Array.isArray(extra?.errors) ? extra.errors : []
    }
    if (extra?.code) payload.code = extra.code
    if (extra?.message) payload.message = extra.message
    if (managedExtensions) payload.managedExtensions = managedExtensions
    const derivedExtensionId = deriveDistExtensionId(
      options.browser,
      options.distPath
    )
    if (derivedExtensionId) payload.extensionId = derivedExtensionId
    // Preserve fields the launcher wrote post-launch (cdpPort, browser exit
    // evidence): a recompile must not clobber them.
    try {
      if (fs.existsSync(readyPath)) {
        const prev = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
        if (typeof prev.cdpPort === 'number') payload.cdpPort = prev.cdpPort
        if (typeof prev.rdpPort === 'number') payload.rdpPort = prev.rdpPort
        if (
          !payload.managedExtensions &&
          Array.isArray(prev.managedExtensions)
        ) {
          payload.managedExtensions = prev.managedExtensions
        }
        if (typeof prev.profilePath === 'string') {
          payload.profilePath = prev.profilePath
        }
        if (typeof prev.browserPid === 'number') {
          payload.browserPid = prev.browserPid
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
        }
        // The SW attaches once per session but the compile can re-run many
        // times; a recompile must not erase the runtime-attached signal.
        if (typeof prev.executorAttachedAt === 'string') {
          ;(payload as Record<string, unknown>).executorAttachedAt =
            prev.executorAttachedAt
          ;(payload as Record<string, unknown>).runtime = 'attached'
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
    } catch {
      // Ignore
    }
    writeJsonAtomic(readyPath, payload)
  }

  function appendEvent(event: PlaywrightAutomationEvent) {
    if (foreignLiveDevSession) return
    ensureDirSync(metadataDir)
    try {
      fs.appendFileSync(
        eventsPath,
        `${JSON.stringify({...event, runId: event.runId ?? base.runId})}\n`,
        'utf-8'
      )
    } catch {
      // Ignore
    }
  }

  return {
    metadataDir,
    readyPath,
    eventsPath,
    setManagedExtensionDirs(dirs: string[]) {
      managedExtensions = toManagedRecords(dirs)
    },
    writeStarting() {
      if (foreignLiveDevSession) return
      // A new run is the only truth: reset the timeline so prior-run entries don't
      // interleave and the file can't grow unboundedly.
      ensureDirSync(metadataDir)
      try {
        fs.writeFileSync(eventsPath, '', 'utf-8')
      } catch {
        // Ignore
      }
      writeReady('starting')
    },
    writeReady(compiledAt?: string | null) {
      writeReady('ready', {compiledAt: compiledAt || nowISO()})
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
    writeShutdown() {
      if (foreignLiveDevSession) return
      try {
        if (!fs.existsSync(readyPath)) return
        const prev = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
        prev.status = 'stopped'
        prev.code = 'shutdown'
        prev.message = 'the dev session ended (watch closed)'
        prev.ts = nowISO()
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
        if (typeof prev.executorAttachedAt === 'string') return
        prev.executorAttachedAt = nowISO()
        prev.runtime = 'attached'
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

  constructor(options: PluginOptions) {
    this.browser = String(options.browser || 'chromium')
    this.command =
      options.command || (options.mode === 'development' ? 'dev' : 'start')
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
      this.writer.writeReady(nowISO())
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
