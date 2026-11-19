//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as net from 'node:net'
import {
  isPidAlive,
  pidStartedAtMs
} from '../browsers/browsers-lib/resolve-live-pid'
import type {DevelopBridge} from './extension-develop-runtime'
import {otherSessionBrowsers} from './session-project-path'

// The fields of a ready contract that say whether its session still runs.
export interface SessionContract {
  status?: string
  command?: string
  pid?: number
  pidStartedAt?: string
  startedAt?: string
  controlPort?: number
}

export type BrowserSessionCommand = 'dev' | 'start' | 'preview'

// How far the process table's start time may sit from the stamped one. ps
// answers in whole seconds and Windows stamps its own clock.
const PID_START_TOLERANCE_MS = 2000
// Contracts written before the pid carried its own start time are compared
// with when the run began, which the process precedes by a compile at most.
const SERVER_IDENTITY_SKEW_MS = 60_000
const CONTROL_PORT_PROBE_TIMEOUT_MS = 1000

export function sessionCommandOf(
  ready: {command?: unknown} | null | undefined
): BrowserSessionCommand {
  return ready?.command === 'start' || ready?.command === 'preview'
    ? ready.command
    : 'dev'
}

export function sessionNounOf(command: BrowserSessionCommand): string {
  return command === 'dev' ? 'dev session' : `extension ${command} session`
}

// Why the live pid cannot be the process that wrote the contract, or null
// when it can. A pid is handed to another process once its owner exits.
export function reusedPidEvidence(
  ready: SessionContract,
  pidStartedAt = pidStartedAtMs
): string | null {
  const stampedAt = Date.parse(String(ready.pidStartedAt ?? ''))
  const writtenAt = Date.parse(String(ready.startedAt ?? ''))
  if (Number.isNaN(stampedAt) && Number.isNaN(writtenAt)) return null

  const startedAt = pidStartedAt(ready.pid)
  if (startedAt == null) return null

  if (!Number.isNaN(stampedAt)) {
    return Math.abs(startedAt - stampedAt) > PID_START_TOLERANCE_MS
      ? `it started ${new Date(startedAt).toISOString()}, not at the contract's ${ready.pidStartedAt}`
      : null
  }

  return startedAt - writtenAt > SERVER_IDENTITY_SKEW_MS
    ? `it started ${new Date(startedAt).toISOString()}, after the contract's ${ready.startedAt}`
    : null
}

// Only a connection proves a stamped port is still served: the number in
// ready.json outlives the process that opened it.
export function portAnswers(
  port: number,
  timeoutMs = CONTROL_PORT_PROBE_TIMEOUT_MS
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({host: '127.0.0.1', port})

    const answer = (answered: boolean) => {
      socket.destroy()
      resolve(answered)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => answer(true))
    socket.once('timeout', () => answer(false))
    socket.once('error', () => answer(false))
  })
}

async function controlPortAnswers(ready: SessionContract): Promise<boolean> {
  return (
    typeof ready.controlPort === 'number' &&
    (await portAnswers(ready.controlPort))
  )
}

// Why the session a contract names is over, or null while it may still run.
// A pid may live in a container, so it counts only with a silent port.
export async function endedSessionReason(
  ready: SessionContract,
  readyPath: string,
  options?: {dialFailed?: boolean},
  pidStartedAt = pidStartedAtMs
): Promise<string | null> {
  if (ready.status === 'stopped') {
    return `${readyPath} reads status 'stopped'`
  }

  if (ready.pid == null) return null

  if (!isPidAlive(ready.pid)) {
    return (await controlPortAnswers(ready))
      ? null
      : `its process (pid ${ready.pid}) is gone and nothing answers the ` +
          `controlPort ${ready.controlPort} that ${readyPath} names`
  }

  // Dating a pid costs a process start, so it is asked only once a dial
  // has already failed.
  if (!options?.dialFailed) return null

  const reused = reusedPidEvidence(ready, pidStartedAt)
  if (!reused || (await controlPortAnswers(ready))) return null

  return (
    `pid ${ready.pid} in ${readyPath} now belongs to another process ` +
    `(${reused}) and nothing answers controlPort ${ready.controlPort}`
  )
}

// What a hint may call a running session: one whose contract was not stopped
// and whose control port answers, which is all a caller could use it for.
export async function isSessionRunning(
  ready: SessionContract | null | undefined
): Promise<boolean> {
  if (!ready || ready.status === 'stopped') return false

  return controlPortAnswers(ready)
}

// The other browsers of this project whose session can be dialed right now.
export async function runningSessionBrowsers(
  bridge: Partial<DevelopBridge> | undefined,
  projectPath: string,
  browser: string,
  readContract: (
    projectPath: string,
    browser: string
  ) => SessionContract | null | undefined
): Promise<string[]> {
  const candidates = otherSessionBrowsers(
    bridge,
    projectPath,
    browser,
    (candidate) => Boolean(readContract(projectPath, candidate))
  )
  const running: string[] = []

  for (const candidate of candidates) {
    try {
      if (await isSessionRunning(readContract(projectPath, candidate))) {
        running.push(candidate)
      }
    } catch {
      // A contract that cannot be read names no session to offer.
    }
  }

  return running
}

// The refusal for a verb aimed at a session that is over: what ended, and the
// command that starts one, which is the session's own.
export function sessionEndedMessage(input: {
  ready: SessionContract
  browser: string
  reason: string
  flag?: string
}): string {
  const command = sessionCommandOf(input.ready)
  const flag = input.flag ? ` ${input.flag}` : ''

  return (
    `The ${sessionNounOf(command)} for ${input.browser} ended: ${input.reason}. ` +
    `Run \`extension ${command} --browser=${input.browser}${flag}\` to start one.`
  )
}
