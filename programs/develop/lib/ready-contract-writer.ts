// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {ownProcessStartedAt, ownProcessStartId} from './process-started-at'
import {type RenameRetryOptions, renameSyncWithRetry} from './rename-with-retry'

// The one place ready.json is written. The CLI compiles this file into its
// own bundle, so it imports node builtins and its two leaf neighbors only.
export type ReadyRecord = Record<string, unknown>

// The object ready.json holds, or undefined when it is missing or is not
// one: a half-written file is read as no record.
export function readReadyRecord(readyPath: string): ReadyRecord | undefined {
  try {
    if (!fs.existsSync(readyPath)) return undefined

    const value = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))

    return value && typeof value === 'object'
      ? (value as ReadyRecord)
      : undefined
  } catch {
    return undefined
  }
}

// Automation polls ready.json while it is stamped, so an in-place write can
// be read half-written. A rename swaps the whole file in one step.
// Answers the error a failed write threw, or undefined once it is in place.
export function writeReadyRecord(
  readyPath: string,
  record: unknown,
  renameRetry?: RenameRetryOptions
): Error | undefined {
  const tmpPath = `${readyPath}.tmp-${process.pid}`

  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}\n`, 'utf-8')
    renameSyncWithRetry(tmpPath, readyPath, renameRetry)

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

export interface ReadyPatchResult {
  // False when there was no record, or the patch declined to change it.
  written: boolean
  error?: Error
}

// A stamp beside the status: the record on disk with one caller's fields
// changed and every other field, known to this engine or not, left as it is.
// The patch answers false to leave the file alone.
export function patchReadyRecord(
  readyPath: string,
  patch: (ready: ReadyRecord) => boolean | undefined,
  renameRetry?: RenameRetryOptions
): ReadyPatchResult {
  const ready = readReadyRecord(readyPath)
  if (!ready) return {written: false}

  if (patch(ready) === false) return {written: false}

  const error = writeReadyRecord(readyPath, ready, renameRetry)

  return error ? {written: false, error} : {written: true}
}

// A whole rewrite keeps what was stamped beside it: every field of the
// earlier record that the writer does not compute, and has not set, carries.
export function carryStampedFields(
  next: ReadyRecord,
  earlier: ReadyRecord,
  computed: ReadonlySet<string>
): void {
  for (const [field, value] of Object.entries(earlier)) {
    if (computed.has(field) || field in next) continue

    next[field] = value
  }
}

export interface WriterIdentity {
  pid: number
  pidStartedAt: string
  pidStartId?: string
}

// Who wrote the record. A pid is reused once its owner exits, so it is paired
// with when that process started, and on Linux with the kernel's name for it.
export function writerIdentity(): WriterIdentity {
  const pidStartId = ownProcessStartId()

  return {
    pid: process.pid,
    pidStartedAt: ownProcessStartedAt(),
    ...(pidStartId ? {pidStartId} : {})
  }
}

// How a stamp dates and names a pid, so any host can stand in for Linux.
export interface PidStartProbes {
  startedAt: (pid: number) => string | undefined
  startId: (pid: number) => string | undefined
}

const LAUNCHED_PROCESS_FIELDS = {
  browser: {
    pid: 'browserPid',
    startedAt: 'browserStartedAt',
    startId: 'browserStartId'
  },
  launcher: {
    pid: 'launcherPid',
    startedAt: 'launcherStartedAt',
    startId: 'launcherStartId'
  }
} as const

// The process table is asked once per pid: a later stamp naming the same pid
// keeps the answer, and a pid it cannot date carries no time rather than a guess.
export function stampLaunchedProcess(
  ready: ReadyRecord,
  which: keyof typeof LAUNCHED_PROCESS_FIELDS,
  pid: number,
  probes: PidStartProbes
): void {
  const fields = LAUNCHED_PROCESS_FIELDS[which]

  if (ready[fields.pid] === pid) return

  ready[fields.pid] = pid

  const startedAt = probes.startedAt(pid)
  if (startedAt) ready[fields.startedAt] = startedAt
  else delete ready[fields.startedAt]

  // Linux alone names a run of a pid, so the id is absent everywhere else.
  const startId = probes.startId(pid)
  if (startId) ready[fields.startId] = startId
  else delete ready[fields.startId]
}
