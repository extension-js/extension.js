// ██████╗  ██████╗  ██████╗████████╗ ██████╗ ██████╗
// ██╔══██╗██╔═══██╗██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗
// ██║  ██║██║   ██║██║        ██║   ██║   ██║██████╔╝
// ██║  ██║██║   ██║██║        ██║   ██║   ██║██╔══██╗
// ██████╔╝╚██████╔╝╚██████╗   ██║   ╚██████╔╝██║  ██║
// ╚═════╝  ╚═════╝  ╚═════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import type {Command} from 'commander'
import colors from 'pintor'
import {describeJsonReadFailure} from '../../develop/lib/json-parse-position'
import {readReadyRecord} from '../../develop/lib/ready-contract-writer'
import {
  readyContractPath,
  sessionArtifactsRootDir
} from '../../develop/lib/session-contract'
import {isFirefoxBrowser} from '../browsers/browsers-lib/browser-family'
import {
  isPidAlive,
  pidStartedAtMs
} from '../browsers/browsers-lib/resolve-live-pid'
import {refuseUnknownSessionBrowser} from '../helpers/choice-flags'
import {declaredErrorCode} from '../helpers/cli-failure'
import {emulatorSessionRefusal} from '../helpers/emulator-session'
import {exitAfterDrain, exitFailedAfterDrain} from '../helpers/exit-after-drain'
import {
  type DevelopBridge,
  loadExtensionDevelopBridgeModule
} from '../helpers/extension-develop-runtime'
import {
  commandDescriptions,
  doctorHeader,
  doctorRemedy
} from '../helpers/messages'
import {CODES, ENVELOPE, type ErrorCode} from '../helpers/messaging'
import {isJsonOutput, refuseUnreadableOutput} from '../helpers/output-flag'
import {
  missingProjectFolder,
  missingProjectRefusal
} from '../helpers/project-folder'
import {recordedLoadRefusal} from '../helpers/ready-contract-codes'
import {
  describeRspackPeerConflicts,
  describeUnreadableDependencies,
  engineRspackVersion,
  remedyRspackPeerConflicts,
  scanRspackPeers
} from '../helpers/rspack-peer-check'
import {
  type BrowserSessionCommand,
  portAnswers,
  reusedPidEvidence
} from '../helpers/session-liveness'
import {
  resolveSessionProjectPath,
  sessionReadyPath
} from '../helpers/session-project-path'
import {BROWSER_TARGETS_HELP} from '../helpers/vendors'

type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip'

// Which browser binary this session launched, and how it was chosen. doctor is
// the command whose job is answering "why did this behave unexpectedly", and
// "a different browser than you assumed" is a common answer. The identity card
// deliberately does not print this (it would differ machine to machine for
// reasons the reader cannot act on), so the contract is the source and doctor
// is where a human reads it back. Sessions started before these fields existed
// simply have nothing to append.
// A Firefox install updates itself in place and keeps the folder name it was
// downloaded as, so the path alone can name a version the binary left behind.
function declaredGeckoVersion(binary: string): string | undefined {
  const dir = path.dirname(binary)
  const candidates = [
    path.join(dir, 'application.ini'),
    path.join(dir, '..', 'Resources', 'application.ini')
  ]

  for (const candidate of candidates) {
    try {
      const match = /^Version=(.+)$/m.exec(fs.readFileSync(candidate, 'utf8'))
      const version = match?.[1].trim()

      if (version) return version
    } catch {}
  }

  return undefined
}

export function binaryDetailSuffix(ready: {
  binary?: unknown
  binaryProvenance?: unknown
  binaryPinnedBy?: unknown
}): string {
  const binary = String(ready?.binary || '').trim()
  if (!binary) return ''

  const home = os.homedir()
  const tilde =
    home && binary.startsWith(home + path.sep)
      ? `~${binary.slice(home.length)}`
      : binary
  const version = declaredGeckoVersion(binary)
  const shown =
    version && !binary.includes(version)
      ? `${tilde}, which reports version ${version}`
      : tilde
  const provenance = String(ready?.binaryProvenance || '').trim()
  const pinnedBy = String(ready?.binaryPinnedBy || '').trim()

  if (provenance === 'pinned' && pinnedBy) {
    return `, ${shown} (pinned with ${pinnedBy})`
  }

  return provenance ? `, ${shown} (${provenance})` : `, ${shown}`
}

/* @invariant Every check id doctor can emit is named here, once. The code
   table, contract/codes.json and the contract spec all read this list, so a
   check added without a documented error code fails the build, not a host. */
export const DOCTOR_CHECKS = [
  'session-resolution',
  'engine',
  'peer-rspack',
  'ready-contract',
  'server-process',
  'port-agreement',
  'control-channel',
  'eval-token',
  'executor',
  'browser'
] as const

export type DoctorCheck = (typeof DOCTOR_CHECKS)[number]

export interface DoctorCheckResult {
  check: DoctorCheck
  status: CheckStatus
  detail: string
  remediation?: string
  // A row whose cause has a code of its own names it, so the frame reports
  // that cause and not the family code of the check that met it.
  code?: ErrorCode
  // Set to false on a skip that is no gap: the check has no meaning for the
  // kind of session diagnosed, so it leaves the pass count.
  applicable?: false
}

// The session actually diagnosed, so the header, the rows and the json frame
// all name one browser.
export interface DoctorReport {
  browser: string
  checks: DoctorCheckResult[]
}

interface DoctorOptions {
  browser?: string
  output?: 'pretty' | 'json'
}

const CONNECT_TIMEOUT_MS = 5000
const PROBE_TIMEOUT_MS = 3000
const BROWSER_PROBE_TIMEOUT_MS = 1000
// Right after a clean compile the SW has not connected yet; report warn during
// the grace window and only fail once it elapses with no attachment.
const EXECUTOR_ATTACH_GRACE_MS = 10_000

// True when the executor is merely still attaching after a fresh compile:
// within the grace window, no evidence the browser gave up.
function isExecutorAttachGrace(
  ready:
    | {
        executorAttachedAt?: unknown
        runtime?: unknown
        browserExitedAt?: unknown
        compiledAt?: unknown
        status?: unknown
        ts?: unknown
      }
    | null
    | undefined
): boolean {
  // Once the SW has attached, absence is a real regression, never a grace warn.
  if (ready?.executorAttachedAt || ready?.runtime === 'attached') return false
  // An error write stamps a fresh `ts` with `compiledAt: null`, so a failed
  // compile would otherwise read as a launch still in progress.
  if (ready?.status === 'error') return false
  // A browser that exited under a live server is a real failure, not launching.
  if (ready?.browserExitedAt) return false

  const stamp = ready?.compiledAt || ready?.ts
  if (typeof stamp !== 'string') return false

  const compiledMs = Date.parse(stamp)
  if (Number.isNaN(compiledMs)) return false

  return Date.now() - compiledMs < EXECUTOR_ATTACH_GRACE_MS
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g

// Why a contract in `error` failed: its first error, else its message, as one
// plain line. Older engines wrote a fatal compile as colored text in `message`.
function contractFailure(
  ready: {status?: unknown; errors?: unknown; message?: unknown} | null
): string | undefined {
  if (ready?.status !== 'error') return undefined

  const errors = Array.isArray(ready.errors) ? ready.errors : []
  const candidates = [...errors, ready.message]

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue

    const line = candidate
      .replace(ANSI_PATTERN, '')
      .split('\n')
      .map((part) => part.trim())
      .find(Boolean)
    if (line) return line
  }

  return undefined
}

function isCompileFailure(ready: {code?: unknown} | null): boolean {
  return ready?.code === 'compile_error' || ready?.code === 'compile_failed'
}

function readReadyDocument(readyPath: string): Record<string, unknown> | null {
  const parsed = readReadyRecord(readyPath)

  return parsed && !Array.isArray(parsed) ? parsed : null
}

function productionCommand(
  document: Record<string, unknown> | null
): 'start' | 'preview' | undefined {
  return document?.command === 'start' || document?.command === 'preview'
    ? document.command
    : undefined
}

// ready.json doubles as the receipt of a one-shot build, start or preview run.
// A start or preview that opened a control channel is a session the act verbs
// dial, so doctor reads it as one. Every other receipt names nothing to dial.
function isSessionDocument(document: Record<string, unknown>): boolean {
  if (document.command === 'dev') return true

  return (
    productionCommand(document) !== undefined &&
    typeof document.controlPort === 'number' &&
    Boolean(document.instanceId)
  )
}

// The reason a refused load recorded, without the period a sentence adds.
function loadRefusalReason(
  document: Record<string, unknown> | null | undefined
): string {
  return recordedLoadRefusal(document)
}

// A start or preview run that holds its browser open but has no control port:
// alive, and nothing doctor or an act verb can reach.
function liveUncontrolledRun(
  document: Record<string, unknown> | null
): {command: 'start' | 'preview'; pid: number} | undefined {
  const command = productionCommand(document)
  const pid = document?.pid

  if (!command || typeof pid !== 'number') return undefined
  if (document?.status !== 'ready' || !isPidAlive(pid)) return undefined

  return {command, pid}
}

// A contract outlives its session: Ctrl+C leaves it reading `stopped`, and a
// killed process leaves a pid nothing holds.
function namesEndedSession(document: Record<string, unknown>): boolean {
  if (document.status === 'stopped') return true

  return typeof document.pid === 'number' && !isPidAlive(document.pid)
}

function scanReadyContracts(projectPath: string): {
  sessions: string[]
  running: string[]
  receipts: string[]
} {
  const sessionsRoot = sessionArtifactsRootDir(projectPath)
  const sessions: string[] = []
  const running: string[] = []
  const receipts: string[] = []

  try {
    const browsers = fs
      .readdirSync(sessionsRoot, {withFileTypes: true})
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    for (const browser of browsers) {
      const document = readReadyDocument(
        readyContractPath(projectPath, browser)
      )

      if (!document) continue

      if (isSessionDocument(document)) {
        sessions.push(browser)
        if (!namesEndedSession(document)) running.push(browser)
      } else {
        receipts.push(browser)
      }
    }
  } catch {
    // Ignore
  }

  return {sessions, running, receipts}
}

function pickBrowser(candidates: string[]): string | undefined {
  if (candidates.includes('chromium')) return 'chromium'

  return candidates[0]
}

/* @invariant A bare `doctor` diagnoses the session that exists, not a
   hardcoded default: the session contracts under dist/extension-js/ name the
   live browsers, a single contract wins outright, a build receipt never
   counts as a session, and chromium is only the fallback when nothing (or
   an ambiguous set) is found. A session that still runs wins over one that
   ended, and contracts are called live only while one of them runs. */
export function resolveDoctorBrowser(
  projectPath: string | undefined,
  optsBrowser: string | undefined
): {browser: string; sessionBrowsers: string[]; sessionsEnded?: true} {
  if (optsBrowser) return {browser: optsBrowser, sessionBrowsers: []}

  const {sessions, running, receipts} = scanReadyContracts(
    path.resolve(projectPath || process.cwd())
  )

  if (running.length > 0) {
    return {
      browser:
        running.length === 1
          ? running[0]
          : (pickBrowser(running) ?? running[0]),
      sessionBrowsers: running
    }
  }

  if (sessions.length === 1) {
    return {browser: sessions[0], sessionBrowsers: sessions}
  }

  return {
    browser: pickBrowser(sessions) ?? pickBrowser(receipts) ?? 'chromium',
    sessionBrowsers: sessions,
    ...(sessions.length > 1 ? {sessionsEnded: true as const} : {})
  }
}

// The reason a package.json on disk cannot be opened or parsed, or nothing
// when it reads, or when no file is there. Node's parse message quotes the file.
function packageJsonParseFailure(file: string): string | undefined {
  let text: string | undefined

  try {
    if (fs.statSync(file).isDirectory()) return 'it is a folder, not a file'

    text = fs.readFileSync(file, 'utf8')
    JSON.parse(text)

    return undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      return undefined
    }

    return describeJsonReadFailure(error, text)
  }
}

function peerRspackCheck(
  projectPath: string,
  engineVersion: typeof engineRspackVersion,
  scanPeers: typeof scanRspackPeers,
  onDisk: (file: string) => boolean
): DoctorCheckResult {
  // With no package.json nothing was read, and a pass would claim otherwise.
  if (!onDisk(path.join(projectPath, 'package.json'))) {
    return {
      check: 'peer-rspack',
      status: 'skip',
      detail: `skipped: no package.json at ${projectPath}, so there are no dependencies to read`
    }
  }

  // A package.json that is there and is not JSON lists no dependency, and
  // a pass would say every one of them was checked.
  const unparsed = packageJsonParseFailure(
    path.join(projectPath, 'package.json')
  )

  if (unparsed) {
    return {
      check: 'peer-rspack',
      status: 'fail',
      detail: `${path.join(projectPath, 'package.json')} cannot be read as JSON (${unparsed}), so no dependency was checked`,
      remediation: 'Fix package.json, then run doctor again'
    }
  }

  const engine = engineVersion(projectPath)

  if (!engine) {
    return {
      check: 'peer-rspack',
      status: 'skip',
      detail: `skipped: could not read the engine's @rspack/core version from ${projectPath}`
    }
  }

  const {conflicts, unreadable} = scanPeers(projectPath, engine)
  const unverified = unreadable.length
    ? describeUnreadableDependencies(unreadable)
    : ''

  if (conflicts.length > 0) {
    return {
      check: 'peer-rspack',
      status: 'fail',
      detail:
        describeRspackPeerConflicts(conflicts, engine) +
        (unverified ? `. ${unverified}` : ''),
      remediation: remedyRspackPeerConflicts(conflicts, engine)
    }
  }

  if (unreadable.length > 0) {
    return {
      check: 'peer-rspack',
      status: 'warn',
      detail: unverified,
      remediation:
        'Install the project dependencies so their @rspack/core peer ' +
        'ranges can be read, then run doctor again'
    }
  }

  return {
    check: 'peer-rspack',
    status: 'pass',
    detail: `every direct dependency with an @rspack/core peer range accepts the engine's ${engine}`
  }
}

// Chromium stamps cdpPort, Gecko stamps rdpPort. A leg that reads only the
// first calls every Firefox session's browser unknown.
function debuggerPort(ready: {
  cdpPort?: number
  rdpPort?: number
}): {name: string; port: number} | undefined {
  if (typeof ready.cdpPort === 'number') {
    return {name: 'cdpPort', port: ready.cdpPort}
  }

  if (typeof ready.rdpPort === 'number') {
    return {name: 'rdpPort', port: ready.rdpPort}
  }

  return undefined
}

// Only a connection proves a debugger port is still served: the stamped number
// outlives the browser that opened it, including one the OS killed outright.
function probeDebuggerPort(port: number): Promise<boolean> {
  return portAnswers(port, BROWSER_PROBE_TIMEOUT_MS)
}

// The browser leg's verdict: a live pid or an answering debugger port, never
// the mere presence of a stamped port.
async function browserCheck(
  ready: {
    browserPid?: number
    cdpPort?: number
    rdpPort?: number
    binary?: unknown
    binaryProvenance?: unknown
    binaryPinnedBy?: unknown
  },
  sessionNoun: string
): Promise<DoctorCheckResult> {
  const pid =
    typeof ready.browserPid === 'number' ? ready.browserPid : undefined
  const port = debuggerPort(ready)
  const label = port ? `${port.name} ${port.port}` : ''

  if (pid != null && isPidAlive(pid)) {
    return {
      check: 'browser',
      status: 'pass',
      detail: `browser running (pid ${pid}${port ? `, ${label}` : ''})${binaryDetailSuffix(ready)}`
    }
  }

  if (port && (await probeDebuggerPort(port.port))) {
    return {
      check: 'browser',
      status: 'pass',
      detail: `browser running (${label} answers)${binaryDetailSuffix(ready)}`
    }
  }

  if (pid != null || port) {
    return {
      check: 'browser',
      status: 'fail',
      detail:
        `no live browser: ${pid != null ? `pid ${pid} is gone` : 'no browserPid stamped'}` +
        `${port ? ` and nothing answers ${label}` : ' and no debugger port stamped'}` +
        binaryDetailSuffix(ready),
      remediation: `Restart the ${sessionNoun} to relaunch the browser`
    }
  }

  // Absence of exit evidence is not evidence of a live browser: with nothing to
  // probe the leg is unknown, never a green verdict over a possibly-dead browser.
  return {
    check: 'browser',
    status: 'skip',
    detail: `browser liveness unknown (no browserPid or debugger port stamped yet and no exit recorded)${binaryDetailSuffix(ready)}`,
    remediation: `If the browser should be up, wait for launch to finish or restart the ${sessionNoun}`
  }
}

// What a diagnosis reaches outside this file. Production takes every default.
export interface DoctorDeps {
  loadBridge?: () => Promise<DevelopBridge>
  engineVersion?: typeof engineRspackVersion
  scanPeers?: typeof scanRspackPeers
  pidStartedAt?: typeof pidStartedAtMs
  // Whether the project folder, or a file in it, is on disk.
  onDisk?: (file: string) => boolean
}

export async function runDoctor(
  projectPathArg: string | undefined,
  opts: DoctorOptions,
  {
    loadBridge = loadExtensionDevelopBridgeModule,
    engineVersion = engineRspackVersion,
    scanPeers = scanRspackPeers,
    pidStartedAt = pidStartedAtMs,
    onDisk = fs.existsSync
  }: DoctorDeps = {}
): Promise<DoctorReport> {
  const bridge = await loadBridge()
  const projectPath = resolveSessionProjectPath(bridge, projectPathArg)
  const {browser, sessionBrowsers, sessionsEnded} = resolveDoctorBrowser(
    projectPath,
    opts.browser
  )
  const results: DoctorCheckResult[] = []

  if (sessionBrowsers.length > 1) {
    results.push({
      check: 'session-resolution',
      status: 'warn',
      detail: `multiple ${sessionsEnded ? 'ended' : 'live'} sessions found (${sessionBrowsers.join(', ')}), diagnosing ${browser}`,
      remediation: 'Pass --browser=<name> to diagnose a specific session'
    })
  }

  const emulatorRefusal = emulatorSessionRefusal(
    bridge,
    projectPath,
    browser,
    'doctor'
  )

  if (emulatorRefusal) {
    results.push({check: 'engine', status: 'fail', detail: emulatorRefusal})

    return {browser, checks: results}
  }

  // 0. peer-rspack needs only the project, so it runs before the session legs.
  // A dependency whose @rspack/core peer range misses the engine is why
  // `npm install` fails with ERESOLVE next to Extension.js.
  results.push(peerRspackCheck(projectPath, engineVersion, scanPeers, onDisk))

  const skip = (check: DoctorCheck, blockedBy: string) => {
    results.push({
      check,
      status: 'skip',
      detail: `skipped: blocked by ${blockedBy}`
    })
  }

  const {
    BridgeController,
    readReadyContract,
    readControlToken,
    readPersistedControlPort,
    controlPortFilePath
  } = bridge

  const readyPath = sessionReadyPath(bridge, projectPath, browser)
  const document = readReadyDocument(readyPath)
  const receipt = document && !isSessionDocument(document)
  const ready = receipt ? null : readReadyContract(projectPath, browser)

  if (!ready) {
    const uncontrolled = receipt ? liveUncontrolledRun(document) : undefined
    // A refused start or preview run exits and leaves a receipt that says why.
    const refusedRun =
      receipt && document.code === 'extension_load_refused'
        ? productionCommand(document)
        : undefined

    if (uncontrolled) {
      results.push({
        check: 'ready-contract',
        status: 'fail',
        detail:
          `extension ${uncontrolled.command} is running for ${browser} ` +
          `(pid ${uncontrolled.pid}) with no control channel, so there is ` +
          `nothing to diagnose or act on`,
        remediation:
          `Restart it with a control channel: extension ${uncontrolled.command} ` +
          `--browser=${browser} --allow-control (add --allow-eval for the eval verb)`
      })
    } else if (refusedRun) {
      const reason = loadRefusalReason(document)

      results.push({
        check: 'ready-contract',
        status: 'fail',
        detail:
          `the last extension ${refusedRun} run for ${browser} ended because ` +
          `the browser refused to load the extension${reason ? `: ${reason}` : ''}`,
        remediation:
          'Fix what the browser names, then run the same command again: ' +
          `extension ${refusedRun} --browser=${browser} --allow-control ` +
          '(add --allow-eval for the eval verb)',
        code: CODES.E_EXTENSION_LOAD_REFUSED
      })
    } else {
      results.push({
        check: 'ready-contract',
        status: 'fail',
        detail: receipt
          ? `no dev session for ${browser}: ${readyPath} is the receipt of an ` +
            `extension ${String(document?.command ?? 'build')} run, not a session contract`
          : `no ready contract at ${readyPath}`,
        remediation:
          `Start a dev session first: extension dev --browser=${browser} ` +
          `--allow-control (add --allow-eval for the eval verb)`
      })
    }

    for (const check of [
      'server-process',
      'port-agreement',
      'control-channel',
      'eval-token',
      'executor',
      'browser'
    ] as const) {
      skip(check, 'ready-contract')
    }

    return {browser, checks: results}
  }

  // A start or preview session serves a built folder: no dev server and no
  // compile, so the rows name the command that owns the process.
  const sessionCommand: BrowserSessionCommand =
    productionCommand(document) ?? 'dev'
  const production = sessionCommand !== 'dev'
  const sessionNoun = production
    ? `extension ${sessionCommand} session`
    : 'dev session'
  const processNoun = production ? `${sessionCommand} process` : 'dev-server'
  // Firefox has no extension service worker: its background is a page.
  const backgroundNoun = isFirefoxBrowser(browser)
    ? 'background page'
    : 'service worker'
  const restartCommand = `extension ${sessionCommand} --browser=${browser} --allow-control`

  // The reader keeps only the fields it types; why a session failed (`code`,
  // `message`, `errors`) is on the document itself.
  const failure: Record<string, unknown> = {...ready, ...(document ?? {})}

  if (ready.status === 'ready') {
    results.push({
      check: 'ready-contract',
      status: 'pass',
      detail: `status ready, controlPort ${ready.controlPort}, instanceId ${ready.instanceId}${ready.ts ? `, written ${ready.ts}` : ''}`
    })
  } else if (isCompileFailure(failure)) {
    results.push({
      check: 'ready-contract',
      status: 'fail',
      detail:
        `contract status is 'error', the last compile failed` +
        `${contractFailure(failure) ? `: ${contractFailure(failure)}` : ''}`,
      remediation:
        'Fix the compile error and save; the session rebuilds on its own. ' +
        'ready.json `errors` carries the full text'
    })
  } else if (failure.code === 'extension_load_refused') {
    // The browser turned the extension away, which no wait ever changes.
    const reason = loadRefusalReason(failure)

    results.push({
      check: 'ready-contract',
      status: 'fail',
      detail:
        `contract status is 'error', the browser refused to load the ` +
        `extension${reason ? `: ${reason}` : ''}`,
      remediation: production
        ? `Fix what the browser names, build again and restart: ${restartCommand}`
        : 'Fix what the browser names and save, the dev session tries the ' +
          'load again on the next build. If it stays refused, restart it: ' +
          restartCommand,
      code: CODES.E_EXTENSION_LOAD_REFUSED
    })
  } else if (ready.status === 'stopped') {
    // A stopped contract is a session that ended. Waiting on it never helps.
    // One the browser had refused would be refused again by a bare restart.
    const refused = typeof failure.extensionLoadRefusedAt === 'string'
    const reason = loadRefusalReason(failure)

    results.push({
      check: 'ready-contract',
      status: 'fail',
      detail:
        `contract status is 'stopped', the ${sessionNoun} ended` +
        (refused
          ? ` after the browser refused to load the extension${reason ? `: ${reason}` : ''}`
          : ''),
      remediation: refused
        ? `Fix what the browser names, then start it again: ${restartCommand}`
        : `Start it again: ${restartCommand}`,
      ...(refused ? {code: CODES.E_EXTENSION_LOAD_REFUSED} : {})
    })
  } else {
    // preview has no --wait flag, so its advice names the report instead.
    const waitHint =
      sessionCommand === 'preview'
        ? 'run doctor again shortly'
        : `extension ${sessionCommand} --wait`

    results.push({
      check: 'ready-contract',
      status: 'fail',
      detail: `contract status is '${ready.status ?? 'unknown'}', not 'ready'`,
      remediation:
        'The session is still starting or errored, wait for it ' +
        `(${waitHint}) or check the ${processNoun} output`
    })
  }

  // A failed compile is why no executor attaches, so the executor leg names it.
  const compileFailure = isCompileFailure(failure)
    ? contractFailure(failure)
    : undefined
  const compileFailureResult = (): DoctorCheckResult => ({
    check: 'executor',
    status: 'fail',
    detail: `no executor can attach: the last compile failed${compileFailure ? `: ${compileFailure}` : ''}`,
    remediation:
      'Fix the compile error and save; the extension attaches after the next clean compile'
  })

  let serverAlive = true

  if (ready.pid == null) {
    results.push({
      check: 'server-process',
      status: 'skip',
      detail:
        'skipped: contract has no pid (session started by an older extension-develop)'
    })
  } else {
    // A live pid is only half the evidence: the other half is that it is still
    // the process the contract was written by.
    const stale = isPidAlive(ready.pid)
      ? reusedPidEvidence(ready, pidStartedAt)
      : 'the process is gone'

    if (stale) {
      serverAlive = false
      results.push({
        check: 'server-process',
        status: 'fail',
        detail: `${processNoun} pid ${ready.pid} is stale (${stale}), ready.json no longer names a live session`,
        remediation: `A previous ${sessionNoun} died uncleanly; restart it: ${restartCommand}`
      })
    } else {
      results.push({
        check: 'server-process',
        status: 'pass',
        detail: `${processNoun} pid ${ready.pid} is alive`
      })
    }
  }

  // 3. port-agreement, still meaningful when the server is dead: a mismatch
  // predicts the next restart's stale-SW strand (#484 precondition).
  if (production) {
    // Only the dev server persists its control port. A file left by an earlier
    // dev run says nothing about this session's port.
    results.push({
      check: 'port-agreement',
      status: 'skip',
      applicable: false,
      detail:
        `not applicable: an ${sessionNoun} runs no dev server, so it ` +
        'persists no control port to compare'
    })
  } else if (
    typeof readPersistedControlPort !== 'function' ||
    typeof controlPortFilePath !== 'function'
  ) {
    results.push({
      check: 'port-agreement',
      status: 'skip',
      detail:
        'skipped: installed extension-develop does not expose the persisted control port'
    })
  } else {
    const persisted = readPersistedControlPort(
      controlPortFilePath(projectPath, browser)
    )

    if (persisted == null) {
      results.push({
        check: 'port-agreement',
        status: 'pass',
        detail:
          'no persisted control-port file (first session for this project+browser)'
      })
    } else if (persisted === ready.controlPort) {
      results.push({
        check: 'port-agreement',
        status: 'pass',
        detail: `persisted port ${persisted} matches the ${serverAlive && ready.status !== 'stopped' ? 'live contract' : 'contract of the session that ended'}`
      })
    } else {
      results.push({
        check: 'port-agreement',
        status: 'fail',
        detail: `persisted port ${persisted} != contract port ${ready.controlPort}`,
        remediation:
          `A profile's cached ${backgroundNoun} may dial the old port and never ` +
          `connect; restart the ${sessionNoun} (it prefers the persisted port)`
      })
    }
  }

  const token = readControlToken(projectPath, browser) ?? undefined

  if (!serverAlive) {
    skip('control-channel', 'server-process')
    skip('eval-token', 'control-channel')
    skip('executor', 'control-channel')
  } else {
    const controller = new BridgeController({
      controlPort: ready.controlPort,
      instanceId: ready.instanceId,
      token,
      connectTimeoutMs: CONNECT_TIMEOUT_MS
    })

    let readyFrame: {capabilities?: {eval?: unknown}} | null = null

    try {
      readyFrame = await controller.connect()
      results.push({
        check: 'control-channel',
        status: 'pass',
        detail: `connected, capabilities: ${JSON.stringify(readyFrame?.capabilities ?? {})}`
      })
    } catch (err) {
      const message = String((err as Error | undefined)?.message || err)
      const code = /code (\d+)/.exec(message)?.[1]
      let detail = message
      let remediation =
        'The control server did not answer on the contract port, the ' +
        `session may have died or the port was taken; restart the ${sessionNoun}`

      if (code === '4001') {
        detail =
          'refused: ready.json instanceId no longer matches the live server'

        remediation =
          'A newer session overwrote the contract, or this dist belongs to ' +
          `another session, re-read ready.json or restart the ${sessionNoun}`
      } else if (code === '4003') {
        // The instanceId matched, so this is the session itself with control
        // off, not a stale server answering the port.
        detail = 'refused: control is off in the session that answered'
        remediation = `Restart with control enabled: ${restartCommand}`
      }

      results.push({
        check: 'control-channel',
        status: 'fail',
        detail,
        remediation
      })

      skip('eval-token', 'control-channel')
      skip('executor', 'control-channel')
    }

    if (readyFrame) {
      if (readyFrame.capabilities?.eval) {
        if (token) {
          results.push({
            check: 'eval-token',
            status: 'pass',
            detail: 'eval enabled and the session token is readable'
          })
        } else {
          results.push({
            check: 'eval-token',
            status: 'fail',
            detail:
              'eval is enabled but no session token could be read under .extension-js/',
            remediation:
              `Run from the same project root the ${sessionNoun} was started ` +
              'in, or restart the session with --allow-eval to rewrite the token'
          })
        }
      } else {
        results.push({
          check: 'eval-token',
          status: 'pass',
          detail: 'eval disabled (--allow-eval not set), nothing to verify'
        })
      }

      // 6. executor, any ROUTED result (even an in-SW error) proves the
      // executor is alive; Unavailable (absent) and Timeout (silent) do not.
      try {
        const probe = await controller.command({
          op: 'storage.get',
          target: {context: 'background'},
          args: {area: 'local'},
          timeoutMs: PROBE_TIMEOUT_MS
        })

        const unanswered =
          !probe.ok &&
          (probe.error?.name === 'Unavailable' ||
            probe.error?.name === 'Timeout')

        if (!unanswered) {
          results.push({
            check: 'executor',
            status: 'pass',
            detail: probe.ok
              ? 'executor responded to a storage probe'
              : `executor responded (probe errored in-extension: ${probe.error?.message ?? 'unknown'})`
          })
        } else if (probe.error?.name === 'Timeout') {
          results.push({
            check: 'executor',
            status: 'fail',
            detail:
              'executor did not answer a storage probe within ' +
              `${PROBE_TIMEOUT_MS / 1000}s; the ${backgroundNoun} is connected ` +
              'but not responding',
            remediation: `Reload the extension, or restart the ${sessionNoun} if it stays silent`
          })
        } else if (isCompileFailure(failure)) {
          results.push(compileFailureResult())
        } else if (
          // A build with no background never attaches, however long the wait.
          probe.error?.code !== 'no_background' &&
          isExecutorAttachGrace(ready)
        ) {
          results.push({
            check: 'executor',
            status: 'warn',
            detail:
              'no executor connected yet. The browser is still launching ' +
              `(within ${EXECUTOR_ATTACH_GRACE_MS / 1000}s of compile); the ` +
              `${backgroundNoun} has not attached`,
            remediation:
              'Give it a moment: wait for ready.json to gain ' +
              '`runtime: "attached"` before acting, or re-run doctor shortly'
          })
        } else {
          results.push({
            check: 'executor',
            status: 'fail',
            detail: probe.error?.message ?? 'no executor connected',
            remediation:
              probe.error?.code === 'no_background'
                ? 'No retry helps: declare a background this browser runs, ' +
                  `build again and restart the ${sessionNoun}`
                : 'The message above names the likely cause; retry shortly, ' +
                  `then reload the extension or restart the ${sessionNoun}`
          })
        }
      } catch (err) {
        if (isCompileFailure(failure)) {
          results.push(compileFailureResult())
        } else if (isExecutorAttachGrace(ready)) {
          results.push({
            check: 'executor',
            status: 'warn',
            detail:
              'executor probe did not complete yet. The browser is still ' +
              `launching (within ${EXECUTOR_ATTACH_GRACE_MS / 1000}s of compile)`,
            remediation:
              'Give it a moment: wait for ready.json to gain ' +
              '`runtime: "attached"` before acting, or re-run doctor shortly'
          })
        } else {
          results.push({
            check: 'executor',
            status: 'fail',
            detail: `probe did not complete: ${String((err as Error | undefined)?.message || err)}`,
            remediation: `Retry shortly; if it persists reload the extension or restart the ${sessionNoun}`
          })
        }
      }
    }

    controller.close()
  }

  // 7. browser, needs only the contract, runs even when 4-6 were skipped.
  if (ready.browserExitedAt) {
    results.push({
      check: 'browser',
      status: 'fail',
      detail: `browser exited at ${ready.browserExitedAt}${ready.browserExitCode != null ? ` (code ${ready.browserExitCode})` : ''} while the ${production ? processNoun : 'dev server'} kept running${binaryDetailSuffix(ready)}`,
      remediation: `Restart the ${sessionNoun} to relaunch the browser`
    })
  } else {
    results.push(await browserCheck(ready, sessionNoun))
  }

  return {browser, checks: results}
}

function checkGlyph(status: CheckStatus): string {
  if (status === 'pass') return colors.green('✓')
  if (status === 'fail') return colors.red('✗')
  if (status === 'warn') return colors.brightYellow('!')

  return colors.gray('–')
}

// The header names the session the rows describe, so it reads the report's own
// browser rather than resolving the raw argument a second time.
function printPretty({browser, checks: results}: DoctorReport): void {
  const passes = results.filter((r) => r.status === 'pass').length
  const notApplicable = results.filter((r) => r.applicable === false).length
  // eslint-disable-next-line no-console
  console.log(
    doctorHeader(browser, passes, results.length - notApplicable, notApplicable)
  )

  const width = Math.max(...results.map((r) => r.check.length))

  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(
      `  ${checkGlyph(r.status)} ${r.check.padEnd(width)}  ${r.detail}`
    )
  }

  const advisory =
    results.find((r) => r.status === 'fail') ??
    results.find((r) => r.status === 'warn')

  if (advisory?.remediation) {
    // eslint-disable-next-line no-console
    console.log(doctorRemedy(advisory.check, advisory.remediation))
  }
}

// A failing check is the only thing the frame can name, so the first failure
// decides error.code. E_DOCTOR_CHECKS_FAILED covers the rest: a check with no
// dominant cause is still a failed run, not an unmapped one.
export const DOCTOR_CHECK_CODES: Record<DoctorCheck, ErrorCode> = {
  'session-resolution': CODES.E_INSTANCE_AMBIGUOUS,
  engine: CODES.E_COMMAND_UNSUPPORTED_FOR_TARGET,
  'peer-rspack': CODES.E_DEPENDENCY_INSTALL,
  'ready-contract': CODES.E_SESSION_NOT_FOUND,
  'server-process': CODES.E_SESSION_NOT_FOUND,
  'port-agreement': CODES.E_CONTROL_UNAVAILABLE,
  'control-channel': CODES.E_CONTROL_UNAVAILABLE,
  'eval-token': CODES.E_TOKEN_MISSING,
  executor: CODES.E_CONTROL_UNAVAILABLE,
  browser: CODES.E_BROWSER_LAUNCH
}

// The first failing row decides the frame's code, its own when it names one.
export function doctorFailureCode(row: DoctorCheckResult): ErrorCode {
  return (
    row.code || DOCTOR_CHECK_CODES[row.check] || CODES.E_DOCTOR_CHECKS_FAILED
  )
}

export function registerDoctorCommand(
  program: Command,
  deps: DoctorDeps = {}
): void {
  program
    .command('doctor')
    .argument(
      '[project-path]',
      'path to the extension project root or the folder holding its manifest'
    )
    .option(
      `--browser <${BROWSER_TARGETS_HELP}>`,
      'which session to diagnose (defaults to the single live session, else chromium)'
    )
    .option(
      '--output <pretty|json>',
      'result format. Use json for a schema-1 envelope on stdout'
    )
    .hook('preAction', refuseUnreadableOutput())
    .hook('preAction', refuseUnknownSessionBrowser())
    .description(commandDescriptions.doctor)
    .action(async (projectPathArg: string | undefined, opts: DoctorOptions) => {
      const asJson = isJsonOutput(opts)
      let report: DoctorReport

      // No check can speak for a folder that is not there, so the run is
      // refused as build, dev, start and preview refuse it.
      const named = missingProjectFolder(projectPathArg)
      const missingFolder =
        named && !(deps.onDisk ?? fs.existsSync)(named) ? named : undefined

      if (missingFolder) {
        const refusal = missingProjectRefusal('doctor', missingFolder)
        const error = {
          code: CODES.E_PROJECT_NOT_FOUND,
          message: refusal.message
        }

        if (asJson) {
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify(
              ENVELOPE.fail('doctor', 'usage', error, {hint: refusal.hint})
            )
          )
        } else {
          // eslint-disable-next-line no-console
          console.error(refusal.stderr)
        }

        await exitFailedAfterDrain({code: error.code, exitCode: 1})

        return
      }

      try {
        report = await runDoctor(projectPathArg, opts, deps)
      } catch (err) {
        const message = String((err as Error | undefined)?.message || err)

        if (asJson) {
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify(
              ENVELOPE.fail('doctor', 'failed', {
                code: declaredErrorCode(err) ?? CODES.E_INTERNAL,
                message
              })
            )
          )
        } else {
          // eslint-disable-next-line no-console
          console.error(message)
        }

        await exitFailedAfterDrain({
          code: declaredErrorCode(err) ?? CODES.E_INTERNAL,
          exitCode: 1,
          error: err,
          step: 'action'
        })

        return
      }

      const failed = report.checks.filter((r) => r.status === 'fail')

      if (asJson) {
        // The checks list is the payload on both verdicts: an unhealthy report
        // is still a report, so `value` rides along with the error. The
        // diagnosed session rides beside it, never inside the list a host maps.
        const frame = failed.length
          ? ENVELOPE.fail(
              'doctor',
              'unhealthy',
              {
                code: doctorFailureCode(failed[0]),
                message: `${failed.length} of ${report.checks.length} doctor checks failed.`
              },
              {
                value: report.checks,
                hint: failed[0].remediation,
                browser: report.browser
              }
            )
          : ENVELOPE.ok('doctor', 'healthy', report.checks, {
              browser: report.browser
            })
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(frame))
      } else {
        printPretty(report)
      }

      await exitAfterDrain(failed.length ? 1 : 0)
    })
}
