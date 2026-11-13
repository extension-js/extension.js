// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import {humanLine, isDebug} from '../../helpers/messaging'
import type {BrowserType} from '../browsers-types'
import * as messages from './messages'

export const FORCE_KILL_GRACE_MS = 5000

// A 'close' on a child we asked to stop is expected; a 'close' on any other
// child means the browser died mid-session and must be surfaced loudly.
const terminatedByUs = new WeakSet<ChildProcess>()

// A browser that re-launched itself is no ChildProcess of ours, only a pid,
// so the same expectation is kept by number for it.
const terminatedPids = new Set<number>()

export function wasTerminatedByUs(child: ChildProcess | null): boolean {
  return !!child && terminatedByUs.has(child)
}

export function wasPidTerminatedByUs(pid: number | null | undefined): boolean {
  return typeof pid === 'number' && terminatedPids.has(pid)
}

function authorLog(line: string | null): void {
  if (line && isDebug()) humanLine(line)
}

function killWindowsTree(pid: number | undefined, sync: boolean): void {
  if (process.platform !== 'win32' || !pid) return

  const args = ['/PID', String(pid), '/T', '/F']

  try {
    if (sync) {
      spawnSync('taskkill', args, {stdio: 'ignore', windowsHide: true})
    } else {
      spawn('taskkill', args, {stdio: 'ignore', windowsHide: true}).on(
        'error',
        () => {}
      )
    }
  } catch {
    // Ignore
  }
}

function signalPid(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal)

    return true
  } catch {
    return false
  }
}

// The pid counterpart of gracefulTerminateChild, for a browser process the
// session adopted after the spawned launcher handed off and exited.
export function gracefulTerminatePid(
  pid: number | null | undefined,
  browser: BrowserType
): void {
  if (!pid || terminatedPids.has(pid)) return

  terminatedPids.add(pid)
  killWindowsTree(pid, false)
  authorLog(messages.enhancedProcessManagementTerminating(browser))
  signalPid(pid, 'SIGTERM')
  const killTimer = setTimeout(() => {
    authorLog(messages.enhancedProcessManagementForceKill(browser))
    signalPid(pid, 'SIGKILL')
  }, FORCE_KILL_GRACE_MS)
  killTimer.unref?.()
}

// The pid counterpart of forceKillChildOnExit.
export function forceKillPidOnExit(
  pid: number | null | undefined,
  browser: BrowserType
): void {
  if (!pid) return

  terminatedPids.add(pid)
  killWindowsTree(pid, true)
  authorLog(messages.enhancedProcessManagementForceKill(browser))
  signalPid(pid, 'SIGKILL')
}

// Signal-path teardown: SIGTERM, then SIGKILL after a grace window. The timer
// is unref'd; if the loop drains first, forceKillChildOnExit is the backstop.
export function gracefulTerminateChild(
  child: ChildProcess | null,
  browser: BrowserType
): void {
  if (!child || child.killed) return

  terminatedByUs.add(child)
  killWindowsTree(child.pid, false)
  authorLog(messages.enhancedProcessManagementTerminating(browser))
  child.kill('SIGTERM')
  const killTimer = setTimeout(() => {
    if (!child.killed) {
      authorLog(messages.enhancedProcessManagementForceKill(browser))
      child.kill('SIGKILL')
    }
  }, FORCE_KILL_GRACE_MS)
  killTimer.unref?.()
}

// Exit-path safety net: an 'exit' handler gets one synchronous slice (no
// timers), so force-kill synchronously; child.killed only means a signal was sent.
export function forceKillChildOnExit(
  child: ChildProcess | null,
  browser: BrowserType
): void {
  if (!child) return

  terminatedByUs.add(child)
  killWindowsTree(child.pid, true)

  try {
    authorLog(messages.enhancedProcessManagementForceKill(browser))
    child.kill('SIGKILL')
  } catch {
    // Ignore
  }
}

export interface ProcessMark {
  pid: number
  started: string
}

function listProcesses(args: string[]): string[] {
  const listed = spawnSync('ps', args, {
    encoding: 'utf8',
    timeout: 2000,
    stdio: ['ignore', 'pipe', 'ignore']
  })

  return String(listed.stdout || '').split(/\r?\n/)
}

// A helper is handed to the system the moment its browser dies, so the tree
// is noted while the browser is still the parent, with each start time.
export function markDescendants(
  rootPid: number | undefined,
  ownerPid: number = process.pid
): ProcessMark[] {
  if (process.platform === 'win32' || !rootPid) return []

  try {
    const rows = listProcesses(['-ax', '-o', 'pid=,ppid=,lstart='])
      .map((row) => /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(row))
      .filter((row): row is RegExpExecArray => row !== null)
      .map((row) => ({
        pid: Number(row[1]),
        parent: Number(row[2]),
        started: row[3]
      }))
    // Only a tree this process spawned is walked, never a pid that happens
    // to carry the same number.
    const root = rows.find((row) => row.pid === rootPid)
    if (!root || root.parent !== ownerPid) return []

    const kept = new Set<number>([rootPid])
    const marks: ProcessMark[] = []

    for (let grew = true; grew; ) {
      grew = false

      for (const row of rows) {
        if (kept.has(row.pid) || !kept.has(row.parent)) continue

        kept.add(row.pid)
        marks.push({pid: row.pid, started: row.started})
        grew = true
      }
    }

    return marks
  } catch {
    return []
  }
}

// Exit-path sweep of what a killed browser leaves behind. A pid is only
// signaled while it still carries the start time it was noted with.
export function forceKillMarkedOnExit(marks: ProcessMark[]): number[] {
  if (process.platform === 'win32' || marks.length === 0) return []

  const killed: number[] = []

  try {
    const pids = marks.map((mark) => mark.pid).join(',')

    for (const row of listProcesses(['-o', 'pid=,lstart=', '-p', pids])) {
      const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(row)
      if (!match) continue

      const pid = Number(match[1])
      const mark = marks.find((entry) => entry.pid === pid)

      if (mark && mark.started === match[2] && signalPid(pid, 'SIGKILL')) {
        killed.push(pid)
      }
    }
  } catch {
    // Ignore
  }

  return killed
}

const BENIGN_SOCKET_ERROR_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ECONNABORTED',
  'ENOTCONN'
])

// Errors from a socket the browser is closing are not a runner fault; treat as
// no-op so a graceful shutdown stays graceful instead of exiting with code 1.
export function isBenignSocketTeardown(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false

  const code = (value as {code?: unknown}).code

  return typeof code === 'string' && BENIGN_SOCKET_ERROR_CODES.has(code)
}
