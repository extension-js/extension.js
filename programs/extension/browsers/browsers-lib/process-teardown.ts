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
