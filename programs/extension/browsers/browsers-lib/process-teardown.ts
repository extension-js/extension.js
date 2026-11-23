// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import * as path from 'node:path'
import {humanLine, isDebug} from '../../helpers/messaging'
import type {BrowserType} from '../browsers-types'
import * as messages from './messages'
import {
  isPidAlive,
  pidStartedAtMs,
  pidStartId,
  sameStartId
} from './resolve-live-pid'

export const FORCE_KILL_GRACE_MS = 5000

// An exit handler runs to the end before the process leaves, so the one
// probe it makes gets a short bound and a slow answer reads as no answer.
export const EXIT_PROBE_TIMEOUT_MS = 1500

export interface ProcessMark {
  pid: number
  started: string
}

// What a teardown asks of the machine, so a caller can stand in for it.
export interface TeardownDependencies {
  platform: NodeJS.Platform
  now: () => number
  isAlive: (pid: number) => boolean
  startedAt: (pid: number) => number | null
  startedAtOnExit: (pid: number) => number | null
  // Linux only. Reads a file, so it costs no process start, even on exit.
  startId: (pid: number) => string | undefined
  mark: (pid: number | undefined) => ProcessMark[]
  sweep: (marks: ProcessMark[]) => number[]
  kill: (pid: number, signal: NodeJS.Signals) => boolean
  killTree: (pid: number) => void
  killTreeOnExit: (pid: number) => void
  askTree: (pid: number) => void
  print: (line: string) => void
}

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

// The system copy by absolute path, so a taskkill earlier on PATH never runs.
export function windowsTaskkillPath(
  env: NodeJS.ProcessEnv = process.env
): string {
  const root = env.SystemRoot || env.windir || 'C:\\Windows'

  return path.win32.join(root, 'System32', 'taskkill.exe')
}

function runTaskkill(
  pid: number | undefined,
  options: {
    sync: boolean
    force: boolean
    platform?: NodeJS.Platform
    waitMs?: number
  }
): void {
  if ((options.platform ?? process.platform) !== 'win32' || !pid) return

  const args = ['/PID', String(pid), '/T', ...(options.force ? ['/F'] : [])]
  const bin = windowsTaskkillPath()

  try {
    if (options.sync) {
      spawnSync(bin, args, {
        stdio: 'ignore',
        windowsHide: true,
        ...(options.waitMs ? {timeout: options.waitMs} : {})
      })
    } else {
      spawn(bin, args, {stdio: 'ignore', windowsHide: true}).on(
        'error',
        () => {}
      )
    }
  } catch {
    // Ignore
  }
}

function killWindowsTree(pid: number | undefined, sync: boolean): void {
  runTaskkill(pid, {sync, force: true})
}

// Ends a process and what it started: the system taskkill on Windows, the
// process group elsewhere, so there the pid must lead a group of its own.
// waitMs bounds a taskkill that is waited for, which has no limit without it.
export function killProcessTree(
  pid: number | undefined,
  options: {sync?: boolean; platform?: NodeJS.Platform; waitMs?: number} = {}
): void {
  const platform = options.platform ?? process.platform

  if (!pid) return

  if (platform === 'win32') {
    runTaskkill(pid, {
      sync: options.sync === true,
      force: true,
      platform,
      waitMs: options.waitMs
    })

    return
  }

  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // Already gone
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

export const teardownDefaults: TeardownDependencies = {
  platform: process.platform,
  now: () => Date.now(),
  isAlive: (pid) => isPidAlive(pid),
  startedAt: (pid) => pidStartedAtMs(pid),
  startedAtOnExit: (pid) =>
    pidStartedAtMs(pid, process.platform, EXIT_PROBE_TIMEOUT_MS),
  startId: (pid) => pidStartId(pid),
  mark: (pid) => markDescendants(pid),
  sweep: (marks) => forceKillMarkedOnExit(marks),
  kill: signalPid,
  killTree: (pid) => killWindowsTree(pid, false),
  killTreeOnExit: (pid) => killWindowsTree(pid, true),
  askTree: (pid) => runTaskkill(pid, {sync: false, force: false}),
  print: (line) => humanLine(line)
}

// A pid is reused once its owner exits. It is still the process asked to
// stop only if the process table dates it no later than the ask.
function startedBy(
  pid: number,
  askedAt: number,
  deps: TeardownDependencies
): boolean {
  const started = deps.startedAt(pid)

  return started !== null && started <= askedAt
}

function forceKill(
  pid: number,
  browser: BrowserType,
  helpers: ProcessMark[],
  deps: TeardownDependencies,
  sigkill: () => void
): void {
  authorLog(messages.enhancedProcessManagementForceKill(browser))

  if (deps.platform === 'win32') {
    deps.killTree(pid)

    return
  }

  sigkill()
  deps.sweep(helpers)
}

// The pid counterpart of gracefulTerminateChild, for a browser process the
// session adopted after the spawned launcher handed off and exited.
export function gracefulTerminatePid(
  pid: number | null | undefined,
  browser: BrowserType,
  deps: TeardownDependencies = teardownDefaults
): void {
  if (!pid || terminatedPids.has(pid)) return

  terminatedPids.add(pid)
  authorLog(messages.enhancedProcessManagementTerminating(browser))

  // ps dates a process to the second, so only a start in an earlier second
  // counts: a pid reused in the second of the ask never passes for the browser.
  const askedAt = Math.floor(deps.now() / 1000) * 1000 - 1
  // Read before the ask, while the pid is surely the browser's.
  const idAtAsk = deps.startId(pid)

  askToStop(pid, deps, () => deps.kill(pid, 'SIGTERM'))
  const killTimer = setTimeout(() => {
    if (!deps.isAlive(pid)) return

    const same = sameStartId(idAtAsk, pid, deps.startId)

    if (
      same === false ||
      (same === undefined && !startedBy(pid, askedAt, deps))
    ) {
      deps.print(messages.browserLeftRunning(browser, pid, deps.platform))

      return
    }

    forceKill(pid, browser, [], deps, () => deps.kill(pid, 'SIGKILL'))
  }, FORCE_KILL_GRACE_MS)
  killTimer.unref?.()
}

// The pid counterpart of forceKillChildOnExit. An adopted pid has no child
// handle, so it is killed only while the table dates it before its adoption.
export function forceKillPidOnExit(
  pid: number | null | undefined,
  browser: BrowserType,
  adoptedAt: number,
  deps: TeardownDependencies = teardownDefaults,
  adoptedStartId?: string
): void {
  if (!pid) return

  // The id it was adopted under decides where both can be read. Else the
  // dates do, and a pid that could not be dated is never signaled on a guess.
  const same = sameStartId(adoptedStartId, pid, deps.startId)
  const started = same === undefined ? deps.startedAtOnExit(pid) : null
  const reused =
    same === undefined ? started === null || started > adoptedAt : !same

  if (reused) {
    if (deps.isAlive(pid)) {
      deps.print(messages.browserLeftRunning(browser, pid, deps.platform))
    }

    return
  }

  terminatedPids.add(pid)
  if (deps.platform === 'win32') deps.killTreeOnExit(pid)

  authorLog(messages.enhancedProcessManagementForceKill(browser))
  deps.kill(pid, 'SIGKILL')
}

// A signal on Windows ends the process at once and orphans its helpers, so
// there the tree is asked to close and the grace timer forces it.
function askToStop(
  pid: number | undefined,
  deps: TeardownDependencies,
  sigterm: () => void
): void {
  if (deps.platform !== 'win32') {
    sigterm()

    return
  }

  if (pid) deps.askTree(pid)
}

// Signal-path teardown: SIGTERM, then a forced kill after a grace window. The
// timer is unref'd; if the loop drains first, forceKillChildOnExit is the backstop.
export function gracefulTerminateChild(
  child: ChildProcess | null,
  browser: BrowserType,
  helpers?: ProcessMark[],
  deps: TeardownDependencies = teardownDefaults
): void {
  if (!child || child.killed || terminatedByUs.has(child)) return

  terminatedByUs.add(child)
  authorLog(messages.enhancedProcessManagementTerminating(browser))

  // Noted while the browser is still the parent, as markDescendants needs.
  const marks = helpers ?? deps.mark(child.pid)
  const askedAt = deps.now()

  askToStop(child.pid, deps, () => child.kill('SIGTERM'))
  const killTimer = setTimeout(() => {
    const pid = child.pid

    // Node frees a child's pid only as it reports the exit, so one that has
    // not exited is still ours. `killed` only says a signal was sent.
    if (!pid || child.exitCode !== null || child.signalCode !== null) return

    if (!startedBy(pid, askedAt, deps)) {
      deps.print(messages.browserLeftRunning(browser, pid, deps.platform))

      return
    }

    forceKill(pid, browser, marks, deps, () => child.kill('SIGKILL'))
  }, FORCE_KILL_GRACE_MS)
  killTimer.unref?.()
}

// Exit-path safety net: an 'exit' handler gets one synchronous slice (no
// timers), so force-kill synchronously; child.killed only means a signal was sent.
export function forceKillChildOnExit(
  child: ChildProcess | null,
  browser: BrowserType,
  deps: TeardownDependencies = teardownDefaults
): void {
  if (!child) return

  terminatedByUs.add(child)
  if (deps.platform === 'win32' && child.pid) deps.killTreeOnExit(child.pid)

  try {
    authorLog(messages.enhancedProcessManagementForceKill(browser))
    child.kill('SIGKILL')
  } catch {
    // Ignore
  }
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
