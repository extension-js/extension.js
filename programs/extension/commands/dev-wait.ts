//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  isPidAlive,
  pidStartedAtMs
} from '../browsers/browsers-lib/resolve-live-pid'
import {
  declaredErrorCode,
  failureHint,
  LOAD_REFUSED_HINT,
  LOAD_REFUSED_STATUS,
  markErrorFramed
} from '../helpers/cli-failure'
import {
  type DevelopBridge,
  loadExtensionDevelopBridgeModule
} from '../helpers/extension-develop-runtime'
import * as messages from '../helpers/messages'
import {CODES, type ErrorCode} from '../helpers/messaging'
import {isValidWholeNumberFlag} from '../helpers/normalize-options'
import {normalizeOutputFormat} from '../helpers/output-flag'
import {
  readyContractErrorCode,
  recordedLoadRefusal,
  stampedLaunchFailureCode
} from '../helpers/ready-contract-codes'
import {reusedPidEvidence} from '../helpers/session-liveness'
import {
  resolveSessionProjectPath,
  sessionReadyPath
} from '../helpers/session-project-path'

export type WaitFormat = 'pretty' | 'json'
export type WaitCommand = 'dev' | 'start'
export const READY_CONTRACT_FRESHNESS_MS = 60_000

export type ReadyContractPayload = {
  status?: string
  message?: string
  errors?: string[]
  code?: string
  browserLaunchFailedCode?: string
  command?: string
  browser?: string
  runId?: string
  startedAt?: string
  distPath?: string
  manifestPath?: string
  port?: number | null
  pid?: number
  pidStartedAt?: string
  ts?: string
  compiledAt?: string | null
  extensionLoadRefusedAt?: string
  extensionLoadRefusedReason?: string
  extensionLoadRefusedCause?: string
}

export type RunWaitModeOptions = {
  command: WaitCommand
  pathOrRemoteUrl?: string
  browsers: string[]
  waitTimeout?: string | number
  waitFormat?: string
}

// The clock, the pause between polls, the bridge loader a wait reads and the
// probe that dates a pid.
export type WaitModeDeps = {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  loadBridge?: () => Promise<DevelopBridge>
  pidStartedAt?: (pid: number | null | undefined) => number | null
}

const systemNow = (): number => Date.now()

const systemSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export type RunWaitModeResult = {
  projectPath: string
  command: WaitCommand
  timeoutMs: number
  format: WaitFormat
  browsers: string[]
  results: Array<ReadyContractPayload & {browser: string}>
}

function isHttpUrl(value?: string): boolean {
  if (!value) return false

  return /^https?:\/\//i.test(value)
}

// --wait polls for the contract dev writes at the package root, so the
// argument has to resolve the way dev resolves it, not as given.
async function resolveProjectPath(
  pathOrRemoteUrl: string | undefined,
  loadBridge: () => Promise<DevelopBridge>
): Promise<{
  projectPath: string
  bridge: DevelopBridge | undefined
}> {
  let bridge: DevelopBridge | undefined

  // A coded refusal (no engine, an unbuilt one, another version) means no
  // session of this install can come up, so the wait answers it at once. An
  // uncoded load failure falls back to the plain dist/extension-js path.
  try {
    bridge = await loadBridge()
  } catch (error) {
    const code = declaredErrorCode(error)

    if (code) {
      throw new WaitModeError(
        error instanceof Error ? error.message : String(error),
        code
      )
    }

    bridge = undefined
  }

  return {
    projectPath: resolveSessionProjectPath(bridge, pathOrRemoteUrl),
    bridge
  }
}

function parseWaitTimeoutMs(value?: string | number): number {
  if (value === undefined) return 60000

  if (!isValidWholeNumberFlag('--wait-timeout', value)) {
    throw new WaitModeError(
      messages.invalidWholeNumberFlag('--wait-timeout', String(value)),
      CODES.E_INVALID_OPTION
    )
  }

  return Number(String(value).trim())
}

// Exported so a caller can resolve the format before runWaitMode runs, and
// still report a machine-readable frame when it throws.
export function parseWaitFormat(value?: string): WaitFormat {
  return normalizeOutputFormat(value) ?? 'pretty'
}

// The failure class is known where the throw happens, so tag it there. The
// alternative, matching the message text at the caller, breaks on a copy edit.
export class WaitModeError extends Error {
  readonly code: ErrorCode

  constructor(message: string, code: ErrorCode) {
    super(message)
    this.name = 'WaitModeError'
    this.code = code
  }
}

export interface WaitFailure {
  code: ErrorCode
  status: string
  message: string
  hint: string
}

// Maps a wait rejection onto the envelope fields. Anything untagged is
// E_INTERNAL: a throw nobody classified is a fault, not a known refusal.
export function describeWaitError(error: unknown): WaitFailure {
  const message = error instanceof Error ? error.message : String(error)
  const code = declaredErrorCode(error) ?? CODES.E_INTERNAL

  if (code === CODES.E_ARGS || code === CODES.E_REMOTE_URL_UNSUPPORTED) {
    return {
      code,
      status: 'usage',
      message,
      hint: 'Pass a local project path to --wait. Remote URLs are not supported.'
    }
  }

  if (code === CODES.E_INVALID_OPTION) {
    return {
      code,
      status: 'usage',
      message,
      hint: 'Fix the value the message names and run the command again.'
    }
  }

  if (code === CODES.E_BROWSER_BINARY_INVALID) {
    return {
      code,
      status: 'usage',
      message,
      hint: 'Pass a browser binary path that exists and runs.'
    }
  }

  if (code === CODES.E_BROWSER_BINARY_REQUIRED) {
    return {
      code,
      status: 'usage',
      message,
      hint: 'Pass --chromium-binary or --gecko-binary with the browser to run.'
    }
  }

  if (code === CODES.E_BROWSER_NOT_FOUND) {
    return {
      code,
      status: 'failed',
      message,
      hint: 'Install the browser, or pass its binary path to the command.'
    }
  }

  if (code === CODES.E_FLAG_NOT_SUPPORTED_HERE) {
    return {
      code,
      status: 'usage',
      message,
      hint: 'Let Extension.js manage the profile, or pass --profile=<path>.'
    }
  }

  // The session wrote down that the browser turned the extension away.
  if (code === CODES.E_EXTENSION_LOAD_REFUSED) {
    return {
      code,
      status: LOAD_REFUSED_STATUS,
      message,
      hint: LOAD_REFUSED_HINT
    }
  }

  if (code === CODES.E_READY_TIMEOUT) {
    return {
      code,
      status: 'timeout',
      message,
      hint: 'Raise --wait-timeout, or read the server output for what kept it from reporting ready.'
    }
  }

  return {
    code,
    status: 'failed',
    message,
    hint:
      failureHint(code) ??
      'Read the server output for the failure behind the ready contract.'
  }
}

// A WaitModeError message carries no channel glyph, so the top-level sink
// renders it as err.stack: cli.cjs offsets for a plain timeout. Rethrow the
// rendered frame instead, keeping the code the envelope and telemetry read.
export function framedWaitFailure(
  error: unknown,
  failure: WaitFailure,
  framedForJson: boolean
): Error {
  const framed = new Error(messages.waitModeFailed(failure))
  framed.name = error instanceof Error ? error.name : 'WaitModeError'
  ;(framed as {code?: ErrorCode}).code = failure.code

  if (framedForJson) markErrorFramed(framed)

  return framed
}

// A contract with no usable pid cannot be judged dead. EPERM is a live process
// of another user, which isPidAlive reads as alive.
function isProcessLikelyAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return true

  return isPidAlive(pid)
}

export function isFreshContractPayload(
  payload: ReadyContractPayload,
  now: () => number = systemNow
): boolean {
  const candidates = [payload.ts, payload.compiledAt, payload.startedAt]

  for (const candidate of candidates) {
    if (!candidate) continue

    const stamp = Date.parse(candidate)
    if (!Number.isFinite(stamp)) continue

    return now() - stamp <= READY_CONTRACT_FRESHNESS_MS
  }

  return false
}

// A run that ended on a refusal keeps saying so however old it is: the same
// manifest is refused again. An edit since then means a new run is due.
export function standingLoadRefusal(
  payload: ReadyContractPayload
): string | undefined {
  const refusedAt = Date.parse(String(payload.extensionLoadRefusedAt ?? ''))

  if (!Number.isFinite(refusedAt)) return undefined

  const manifests = [
    payload.manifestPath,
    payload.distPath ? path.join(payload.distPath, 'manifest.json') : undefined
  ]

  for (const manifest of manifests) {
    try {
      if (!manifest || fs.statSync(manifest).mtimeMs > refusedAt) {
        return undefined
      }
    } catch {
      return undefined
    }
  }

  if (payload.code === 'extension_load_refused' && payload.message) {
    return withRefusalCause(String(payload.message), payload)
  }

  const reason = recordedLoadRefusal(payload)

  return `The browser refused to load the extension${reason ? `: ${reason}.` : ''}`
}

// The contract's message carries the browser's words. The cause the launcher
// read off the manifest sits in its own field, so it is added here.
function withRefusalCause(
  message: string,
  payload: ReadyContractPayload
): string {
  const cause = String(payload.extensionLoadRefusedCause ?? '').trim()

  return cause ? `${message.replace(/[.\s]+$/, '')}. ${cause}` : message
}

interface PendingContract {
  readyPath: string
  lastReadFailure: string
  payload?: ReadyContractPayload
}

// One read of one contract: the payload once it is ready, nothing while it is
// not, a throw when the session already failed.
function readReadyContract(
  pending: PendingContract,
  command: WaitCommand,
  now: () => number,
  isLive: (payload: ReadyContractPayload) => boolean
): ReadyContractPayload | undefined {
  if (!fs.existsSync(pending.readyPath)) return undefined

  let payload: ReadyContractPayload | null

  try {
    payload = JSON.parse(
      fs.readFileSync(pending.readyPath, 'utf8')
    ) as ReadyContractPayload

    pending.lastReadFailure = ''
  } catch (error) {
    // A contract read while its producer still writes it parses as nothing.
    // That is a transient state like the ones below, so poll again.
    pending.lastReadFailure =
      error instanceof Error ? error.message : String(error)

    return undefined
  }

  if (!payload || payload.command !== command) return undefined

  const live = isLive(payload)
  const isFresh = isFreshContractPayload(payload, now)

  // Waiting on a run the browser refused would only spend the timeout.
  const refusal = live ? undefined : standingLoadRefusal(payload)

  if (refusal) {
    throw new WaitModeError(refusal, CODES.E_EXTENSION_LOAD_REFUSED)
  }

  // A recent error from a run that already exited is its answer. An old one
  // belongs to an earlier run, and the producer about to start will replace it.
  if (payload.status === 'error' && (live || isFresh)) {
    const detail = payload.message || payload.errors?.[0] || 'unknown error'

    // A launch the launcher coded keeps the code it was refused with.
    throw new WaitModeError(
      withRefusalCause(String(detail), payload),
      stampedLaunchFailureCode(payload) ??
        readyContractErrorCode(payload.code) ??
        CODES.E_READY_ERROR_STATUS
    )
  }

  // start can complete quickly; accept recent contracts from completed start
  // runs. Dead dev producers are always stale for wait purposes.
  if (!live && (command !== 'start' || !isFresh)) return undefined

  return payload.status === 'ready' ? payload : undefined
}

// Alive is not enough: a pid outlives its process and goes to the next one.
// Dating a pid starts a process, so each contract identity is dated once.
function sessionLiveness(
  pidStartedAt: (pid: number | null | undefined) => number | null
): (payload: ReadyContractPayload) => boolean {
  const reused = new Map<string, boolean>()

  return (payload) => {
    if (!isProcessLikelyAlive(payload.pid)) return false
    if (typeof payload.pid !== 'number') return true

    const key = `${payload.pid}|${payload.pidStartedAt}|${payload.startedAt}`

    if (!reused.has(key)) {
      reused.set(key, reusedPidEvidence(payload, pidStartedAt) !== null)
    }

    return !reused.get(key)
  }
}

// Every browser is read on each poll against one deadline, so --wait-timeout
// bounds the whole wait however many browsers it names.
async function waitForReadyContracts(options: {
  command: WaitCommand
  readyPaths: string[]
  timeoutMs: number
  now: () => number
  sleep: (ms: number) => Promise<void>
  isLive: (payload: ReadyContractPayload) => boolean
}): Promise<ReadyContractPayload[]> {
  const {now, sleep} = options
  const pending: PendingContract[] = options.readyPaths.map((readyPath) => ({
    readyPath,
    lastReadFailure: ''
  }))
  const start = now()

  while (now() - start < options.timeoutMs) {
    for (const contract of pending) {
      contract.payload ??= readReadyContract(
        contract,
        options.command,
        now,
        options.isLive
      )
    }

    if (pending.every((contract) => contract.payload)) {
      return pending.map((contract) => contract.payload as ReadyContractPayload)
    }

    await sleep(250)
  }

  const missing = pending.filter((contract) => !contract.payload)
  // A contract that could not be read is a different problem from one that
  // never arrived, and the timeout alone would point the reader at the wrong one.
  const lastReadFailure = missing.find(
    (contract) => contract.lastReadFailure
  )?.lastReadFailure
  const timeoutDetail = lastReadFailure
    ? `. The last read of the file failed to parse as JSON: ${lastReadFailure}`
    : ''

  throw new WaitModeError(
    `Timed out waiting for ready contract at ${missing
      .map((contract) => contract.readyPath)
      .join(', ')} (${options.timeoutMs} ms)${timeoutDetail}`,
    CODES.E_READY_TIMEOUT
  )
}

export async function runWaitMode(
  options: RunWaitModeOptions,
  {
    now = systemNow,
    sleep = systemSleep,
    loadBridge = loadExtensionDevelopBridgeModule,
    pidStartedAt = pidStartedAtMs
  }: WaitModeDeps = {}
): Promise<RunWaitModeResult> {
  if (isHttpUrl(options.pathOrRemoteUrl)) {
    throw new WaitModeError(
      '--wait requires a local project path (remote URLs are not supported)',
      CODES.E_REMOTE_URL_UNSUPPORTED
    )
  }

  const {projectPath, bridge} = await resolveProjectPath(
    options.pathOrRemoteUrl,
    loadBridge
  )
  const timeoutMs = parseWaitTimeoutMs(options.waitTimeout)
  const format = parseWaitFormat(options.waitFormat)
  const payloads = await waitForReadyContracts({
    command: options.command,
    readyPaths: options.browsers.map((browser) =>
      sessionReadyPath(bridge, projectPath, browser)
    ),
    timeoutMs,
    now,
    sleep,
    isLive: sessionLiveness(pidStartedAt)
  })
  const results = payloads.map((payload, index) => ({
    ...payload,
    browser: options.browsers[index]
  }))

  return {
    projectPath,
    command: options.command,
    timeoutMs,
    format,
    browsers: options.browsers,
    results
  }
}

export async function runDevWaitMode(
  options: Omit<RunWaitModeOptions, 'command'>,
  deps?: WaitModeDeps
): Promise<RunWaitModeResult> {
  return runWaitMode({...options, command: 'dev'}, deps)
}
