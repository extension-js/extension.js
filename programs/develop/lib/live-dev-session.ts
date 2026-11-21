// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {processStartedAtMs, processStartId} from './process-started-at'
import {readReadyRecord} from './ready-contract-writer'
import {readyContractPath} from './session-paths'

export interface LiveDevSession {
  distPath: string
  pid: number
}

// EPERM is a process that exists under another user: alive, not ours to signal.
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

// How far the process table's start time may sit from the stamped one. ps
// answers in whole seconds, and Windows stamps the writer's own clock.
const PID_START_TOLERANCE_MS = 2000

export interface SessionPidProbes {
  isAlive?: (pid: number) => boolean
  startedAtOf?: (pid: number) => number | null
  startIdOf?: (pid: number) => string | undefined
}

// A pid is handed to another process once its owner exits, so a live pid
// counts only while it started when the contract says its writer did.
export function isSessionPidLive(
  contract: {pid?: unknown; pidStartedAt?: unknown; pidStartId?: unknown},
  probes: SessionPidProbes = {}
): boolean {
  const pid = Number(contract.pid)
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (!(probes.isAlive ?? isProcessAlive)(pid)) return false

  // Where the writer stamped the kernel's own name for its process, that
  // decides: a clock step moves the dates below and never this.
  if (typeof contract.pidStartId === 'string' && contract.pidStartId) {
    const startId = (probes.startIdOf ?? processStartId)(pid)

    if (startId) return startId === contract.pidStartId
  }

  const stampedAt = Date.parse(String(contract.pidStartedAt ?? ''))
  if (Number.isNaN(stampedAt)) return true

  const startedAt = (probes.startedAtOf ?? processStartedAtMs)(pid)
  if (startedAt == null) return true

  return Math.abs(startedAt - stampedAt) <= PID_START_TOLERANCE_MS
}

// A dev session owns ready.json while its producer lives. A stopped, errored
// or orphaned contract belongs to nobody, so a build may replace it.
export function findLiveDevSession(
  projectPath: string,
  browser: string
): LiveDevSession | null {
  const contract = readReadyRecord(readyContractPath(projectPath, browser))

  if (!contract) return null
  if (contract.command !== 'dev') return null
  if (contract.status !== 'starting' && contract.status !== 'ready') return null

  const pid = Number(contract.pid)

  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return null
  if (!isSessionPidLive(contract)) return null

  const distPath =
    typeof contract.distPath === 'string' && contract.distPath
      ? path.resolve(contract.distPath)
      : ''

  return {distPath, pid}
}
