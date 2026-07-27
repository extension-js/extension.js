//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {CODES, type ErrorCode} from '../helpers/messaging'

export type WaitFormat = 'pretty' | 'json'
export type WaitCommand = 'dev' | 'start'
export const READY_CONTRACT_FRESHNESS_MS = 60_000

export type ReadyContractPayload = {
  status?: string
  message?: string
  errors?: string[]
  code?: string
  command?: string
  browser?: string
  runId?: string
  startedAt?: string
  distPath?: string
  manifestPath?: string
  port?: number | null
  pid?: number
  ts?: string
  compiledAt?: string | null
}

export type RunWaitModeOptions = {
  command: WaitCommand
  pathOrRemoteUrl?: string
  browsers: string[]
  waitTimeout?: string | number
  waitFormat?: string
}

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

function resolveProjectPath(pathOrRemoteUrl?: string): string {
  if (!pathOrRemoteUrl) return process.cwd()
  return path.isAbsolute(pathOrRemoteUrl)
    ? pathOrRemoteUrl
    : path.join(process.cwd(), pathOrRemoteUrl)
}

function parseWaitTimeoutMs(value?: string | number): number {
  const fallback = 60000
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

// Exported so a caller can resolve the format before runWaitMode runs, and
// still report a machine-readable frame when it throws.
export function parseWaitFormat(value?: string): WaitFormat {
  return value === 'json' ? 'json' : 'pretty'
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
// E_INTERNAL: there is no code yet for "the ready contract reported an error".
export function describeWaitError(error: unknown): WaitFailure {
  const message = error instanceof Error ? error.message : String(error)
  const tagged = (error as {code?: unknown} | null)?.code
  const code =
    typeof tagged === 'string' && tagged in CODES
      ? (tagged as ErrorCode)
      : CODES.E_INTERNAL

  if (code === CODES.E_ARGS) {
    return {
      code,
      status: 'usage',
      message,
      hint: 'Pass a local project path to --wait. Remote URLs are not supported.'
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
    hint: 'Read the server output for the failure behind the ready contract.'
  }
}

function isProcessLikelyAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return true
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function isFreshContractPayload(payload: ReadyContractPayload): boolean {
  const candidates = [payload.ts, payload.compiledAt, payload.startedAt]
  for (const candidate of candidates) {
    if (!candidate) continue
    const stamp = Date.parse(candidate)
    if (!Number.isFinite(stamp)) continue
    return Date.now() - stamp <= READY_CONTRACT_FRESHNESS_MS
  }
  return false
}

async function waitForReadyContract(options: {
  command: WaitCommand
  projectPath: string
  browser: string
  timeoutMs: number
}): Promise<ReadyContractPayload> {
  const readyPath = path.join(
    options.projectPath,
    'dist',
    'extension-js',
    options.browser,
    'ready.json'
  )
  const start = Date.now()
  while (Date.now() - start < options.timeoutMs) {
    if (fs.existsSync(readyPath)) {
      try {
        const payload = JSON.parse(
          fs.readFileSync(readyPath, 'utf8')
        ) as ReadyContractPayload
        const isLive = isProcessLikelyAlive(payload.pid)
        const isFresh = isFreshContractPayload(payload)
        if (payload.command !== options.command) {
          await new Promise((resolve) => setTimeout(resolve, 250))
          continue
        }
        if (!isLive) {
          // start can complete quickly; accept recent contracts from completed
          // start runs. Dead dev producers are always stale for wait purposes.
          if (options.command !== 'start' || !isFresh) {
            await new Promise((resolve) => setTimeout(resolve, 250))
            continue
          }
        }
        if (payload.status === 'ready') return payload
        if (payload.status === 'error') {
          if (!isLive && options.command !== 'start') {
            await new Promise((resolve) => setTimeout(resolve, 250))
            continue
          }

          const detail =
            payload.message || payload.errors?.[0] || 'unknown error'
          throw new WaitModeError(String(detail), CODES.E_INTERNAL)
        }
      } catch (error) {
        if (error instanceof Error) throw error
        throw new Error(String(error))
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new WaitModeError(
    `Timed out waiting for ready contract at ${readyPath} (${options.timeoutMs} ms)`,
    CODES.E_READY_TIMEOUT
  )
}

export async function runWaitMode(
  options: RunWaitModeOptions
): Promise<RunWaitModeResult> {
  if (isHttpUrl(options.pathOrRemoteUrl)) {
    throw new WaitModeError(
      '--wait requires a local project path (remote URLs are not supported)',
      CODES.E_ARGS
    )
  }

  const projectPath = resolveProjectPath(options.pathOrRemoteUrl)
  const timeoutMs = parseWaitTimeoutMs(options.waitTimeout)
  const format = parseWaitFormat(options.waitFormat)
  const results: Array<ReadyContractPayload & {browser: string}> = []

  for (const browser of options.browsers) {
    const payload = await waitForReadyContract({
      command: options.command,
      projectPath,
      browser,
      timeoutMs
    })
    results.push({...payload, browser})
  }

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
  options: Omit<RunWaitModeOptions, 'command'>
): Promise<RunWaitModeResult> {
  return runWaitMode({...options, command: 'dev'})
}
