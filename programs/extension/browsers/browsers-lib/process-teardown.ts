// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {ChildProcess, spawn, spawnSync} from 'child_process'
import * as messages from './messages'
import type {BrowserType} from '../browsers-types'

export const FORCE_KILL_GRACE_MS = 5000

// Children we asked to stop (signal handlers, auto-exit, dev-server teardown).
// A 'close' on one of these is expected; a 'close' on any other child means the
// browser died out from under a live dev session and must be surfaced loudly.
const terminatedByUs = new WeakSet<ChildProcess>()

export function wasTerminatedByUs(child: ChildProcess | null): boolean {
  return !!child && terminatedByUs.has(child)
}

function authorLog(line: string | null): void {
  if (line && process.env.EXTENSION_AUTHOR_MODE === 'true') console.log(line)
}

function killWindowsTree(child: ChildProcess, sync: boolean): void {
  if (process.platform !== 'win32') return
  const args = ['/PID', String(child.pid), '/T', '/F']
  try {
    if (sync) {
      spawnSync('taskkill', args, {stdio: 'ignore', windowsHide: true})
    } else {
      spawn('taskkill', args, {stdio: 'ignore', windowsHide: true}).on(
        'error',
        () => {}
      )
    }
  } catch {}
}

// Signal-path teardown: ask the browser to stop, then escalate to SIGKILL after
// a grace window. The timer is unref'd so it never holds the loop open on its
// own — if the loop drains first, forceKillChildOnExit (run from the 'exit'
// handler) is the backstop that actually delivers the kill.
export function gracefulTerminateChild(
  child: ChildProcess | null,
  browser: BrowserType
): void {
  if (!child || child.killed) return
  terminatedByUs.add(child)
  killWindowsTree(child, false)
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

// Exit-path safety net: a Node 'exit' handler gets one synchronous slice —
// timers and promise continuations never run. So an unref'd SIGKILL timer is
// dead weight here and a child that ignored SIGTERM would outlive the process.
// Force-kill synchronously and unconditionally (child.killed only means a
// signal was sent, not that the process is gone), guarded against ESRCH.
export function forceKillChildOnExit(
  child: ChildProcess | null,
  browser: BrowserType
): void {
  if (!child) return
  terminatedByUs.add(child)
  killWindowsTree(child, true)
  try {
    authorLog(messages.enhancedProcessManagementForceKill(browser))
    child.kill('SIGKILL')
  } catch {}
}

const BENIGN_SOCKET_ERROR_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ECONNABORTED',
  'ENOTCONN'
])

// Errors from a socket the browser is in the middle of closing — the peer hung
// up while a read was in flight. Not a runner fault; treat as no-op so a
// graceful shutdown stays graceful instead of force-exiting with code 1.
export function isBenignSocketTeardown(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const code = (value as {code?: unknown}).code
  return typeof code === 'string' && BENIGN_SOCKET_ERROR_CODES.has(code)
}
