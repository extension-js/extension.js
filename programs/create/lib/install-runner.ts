//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {ChildProcess, SpawnOptions} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {spawn} from 'cross-spawn'
import {corepackRegistryEnv} from './corepack-registry'
import {formatDuration} from './format-duration'

// A package manager exports every npm config it read as an npm_config_* variable,
// so the invoking checkout's release-age rule would govern the new project's
// install. The project never agreed to it, and its own .npmrc still wins here.
// A rule the user exported on purpose is theirs and travels through: only a
// value that matches the file the invoking package manager read is dropped.
const INHERITED_RELEASE_AGE =
  /^(?:npm|pnpm)_config_minimum[-_]?release[-_]?age$/i
const INHERITED_RELEASE_AGE_RULE =
  /^(?:npm|pnpm)_config_minimum[-_]?release[-_]?age/i
const NPMRC_RELEASE_AGE = /^\s*minimum-release-age\s*=\s*(.*?)\s*$/

function readNpmrcReleaseAge(dir: string): string | null {
  try {
    for (const line of fs
      .readFileSync(path.join(dir, '.npmrc'), 'utf8')
      .split(/\r?\n/)) {
      const match = NPMRC_RELEASE_AGE.exec(line)
      if (match) return match[1]
    }
  } catch {
    // No .npmrc here, keep walking.
  }

  return null
}

// pnpm 10 also reads a top-level minimumReleaseAge from pnpm-workspace.yaml.
// Only an unindented key is a setting, one under another key is not.
function readWorkspaceReleaseAge(dir: string): string | null {
  try {
    for (const line of fs
      .readFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'utf8')
      .split(/\r?\n/)) {
      if (!line.startsWith('minimumReleaseAge:')) continue

      const hash = line.indexOf('#')
      const value = (hash === -1 ? line : line.slice(0, hash))
        .slice('minimumReleaseAge:'.length)
        .trim()
      const quoted =
        value.length >= 2 &&
        (value[0] === "'" || value[0] === '"') &&
        value[value.length - 1] === value[0]

      return quoted ? value.slice(1, -1).trim() : value
    }
  } catch {
    // No pnpm-workspace.yaml here, keep walking.
  }

  return null
}

// The release age the invoking package manager read, walking up from where
// it was started (INIT_CWD under npm, pnpm and yarn scripts). In one folder
// pnpm-workspace.yaml wins over .npmrc, as it does for pnpm itself.
export function invokingNpmrcReleaseAge(
  source: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd()
): string | null {
  const starts = [source.INIT_CWD, cwd].filter((dir): dir is string =>
    Boolean(dir)
  )

  for (const start of starts) {
    let dir = path.resolve(start)

    while (true) {
      const found = readWorkspaceReleaseAge(dir) ?? readNpmrcReleaseAge(dir)
      if (found !== null) return found

      const parent = path.dirname(dir)
      if (parent === dir) break

      dir = parent
    }
  }

  return null
}

export function withoutInheritedReleaseAge(
  source: Record<string, string | undefined>,
  npmrcReleaseAge: string | null = invokingNpmrcReleaseAge(source)
): Record<string, string | undefined> {
  const env = {...source}
  const inherited = Object.keys(env).filter(
    (key) =>
      INHERITED_RELEASE_AGE.test(key) &&
      npmrcReleaseAge !== null &&
      String(env[key] ?? '').trim() === npmrcReleaseAge
  )

  if (inherited.length === 0) return env

  // The exclusions that ride along with that rule go with it.
  for (const key of Object.keys(env)) {
    if (INHERITED_RELEASE_AGE_RULE.test(key)) {
      Reflect.deleteProperty(env, key)
    }
  }

  return env
}

export function buildExecEnv(
  source: Record<string, string | undefined>,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath
): Record<string, string | undefined> {
  const env = {
    ...withoutInheritedReleaseAge(source),
    ...corepackRegistryEnv(source, cwd)
  }

  if (platform !== 'win32') return env

  const nodeDir = path.win32.dirname(execPath)
  const pathSep = path.win32.delimiter
  const existing = source.PATH || source.Path || ''

  if (existing.includes(nodeDir)) return env

  return {
    ...env,
    PATH: `${nodeDir}${pathSep}${existing}`.trim(),
    Path: `${nodeDir}${pathSep}${existing}`.trim()
  }
}

const DEFAULT_INSTALL_TIMEOUT_MS = 30 * 60_000
// A longer delay overflows the timer and fires at once.
const LONGEST_TIMER_MS = 2_147_483_647

// Its own variable: the fetch budget is a minute, and a user who raised that
// to two for a slow download must not have a cold install cut off at two.
export function installTimeoutMs(
  source: Record<string, string | undefined> = process.env
): number {
  const raw = parseInt(
    String(source.EXTENSION_CREATE_INSTALL_TIMEOUT_MS || ''),
    10
  )

  return Number.isFinite(raw) && raw > 0
    ? Math.min(raw, LONGEST_TIMER_MS)
    : DEFAULT_INSTALL_TIMEOUT_MS
}

export function installTimedOutReason(ms: number): string {
  return `The install did not finish within ${formatDuration(ms)} (EXTENSION_CREATE_INSTALL_TIMEOUT_MS)`
}

// Node and cross-spawn reject this way when the command is not on PATH.
export function isMissingCommand(error: unknown, command: string): boolean {
  const failure = error as {code?: unknown; syscall?: unknown} | null

  return failure?.code === 'ENOENT' && failure.syscall === `spawn ${command}`
}

export type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions
) => ChildProcess

export type InstallResult = {
  code: number | null
  stderr: string
  stdout: string
  // The signal that ended a child with no exit code.
  signal?: NodeJS.Signals
  // Why the runner ended the child itself, set only when it did.
  reason?: string
}

// What the EXIT row says. A null code is the runner's timeout or a signal,
// and printing "null" told the user neither.
export function installExit(run: InstallResult): number | string {
  if (run.code !== null) return run.code
  if (run.reason !== undefined) return 'timed out'

  return run.signal ? `ended by ${run.signal}` : 'no exit code'
}

// The cause a failed install frame carries when the manager ran and ended
// badly: how it ended and what it said, read by a caller and not off the copy.
export class InstallExitError extends Error {
  readonly command: string
  readonly args: string[]
  readonly exitCode: number | null
  readonly signal?: NodeJS.Signals
  readonly stdout: string
  readonly stderr: string

  constructor(command: string, args: string[], run: InstallResult) {
    super(
      `${[command, ...args].join(' ')} ended with ${installExit(run)}` +
        (run.reason ? `: ${run.reason}` : '')
    )

    this.name = 'InstallExitError'
    this.command = command
    this.args = args
    this.exitCode = run.code
    if (run.signal) this.signal = run.signal

    this.stdout = run.stdout
    this.stderr = run.stderr
  }
}

export interface RunInstallOptions {
  cwd: string
  // 'tee' shows the child's output as it arrives and still captures it.
  stdio: 'inherit' | 'ignore' | 'pipe' | 'tee'
  timeoutMs?: number
  spawn?: SpawnProcess
  platform?: NodeJS.Platform
  // How the install's process group is signaled, process.kill unless given.
  signalGroup?: SignalGroup
}

// Sends a signal to every process in the group the install leads.
export type SignalGroup = (pid: number, signal: NodeJS.Signals) => void

export const signalProcessGroup: SignalGroup = (pid, signal) => {
  process.kill(-pid, signal)
}

// How long a manager gets to end its own children before SIGKILL.
export const KILL_GRACE_MS = 2000
// How long a caller waits for taskkill to answer before it goes on without it.
export const TREE_END_WAIT_MS = 5000

export type InstallRunner = (
  command: string,
  args: string[],
  opts: RunInstallOptions
) => Promise<InstallResult>

function stillRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

// The system copy, so a taskkill earlier on PATH, such as one a project
// folder ships, never runs.
export function windowsTaskkillPath(
  env: Record<string, string | undefined> = process.env
) {
  const root = env.SystemRoot || env.windir || 'C:\\Windows'

  return path.win32.join(root, 'System32', 'taskkill.exe')
}

// A .cmd shim runs the manager as a grandchild of cmd.exe, which a plain kill
// would orphan, so Windows ends the whole tree. On POSIX a child that leads
// its own group is ended with everything it started, a postinstall included.
export function endProcessTree(
  child: ChildProcess,
  spawnProcess: SpawnProcess,
  platform: NodeJS.Platform,
  signalGroup?: SignalGroup,
  // Called once the tree was told to end. Windows only says so when taskkill
  // is done, and a caller that removes the tree's folder before that is refused.
  onAsked?: () => void
) {
  if (platform === 'win32' && child.pid !== undefined) {
    let told = false

    const tell = () => {
      if (told) return

      told = true
      clearTimeout(bound)
      onAsked?.()
    }

    // Armed only for a caller that waits, so no other one is held by it.
    const bound = onAsked ? setTimeout(tell, TREE_END_WAIT_MS) : undefined

    // Only once taskkill has failed: a kill before it runs would end the shim
    // alone and orphan the manager it started.
    const killShim = () => {
      try {
        child.kill('SIGKILL')
      } catch {
        // Already gone.
      }
    }

    try {
      spawnProcess(
        windowsTaskkillPath(),
        ['/pid', String(child.pid), '/T', '/F'],
        {stdio: 'ignore'}
      )
        .on('error', () => {
          killShim()
          tell()
        })
        .on('close', (code: number | null) => {
          if (code !== 0) killShim()

          tell()
        })
    } catch {
      killShim()
      tell()
    }

    return
  }

  const send = (signal: NodeJS.Signals) => {
    try {
      if (signalGroup && child.pid !== undefined) {
        signalGroup(child.pid, signal)
      } else {
        child.kill(signal)
      }
    } catch {
      // Already gone, and the timeout is still what gets reported.
    }
  }

  send('SIGTERM')

  // A group can outlive its leader, so it gets SIGKILL whatever the leader did.
  const escalate = setTimeout(() => {
    if (signalGroup || stillRunning(child)) send('SIGKILL')
  }, KILL_GRACE_MS)
  escalate.unref?.()
  onAsked?.()
}

// A child in its own group no longer hears the terminal's Ctrl+C, so the
// signals that end this process end the install too.
export function forwardEndingSignals(pid: number, signalGroup: SignalGroup) {
  const forwarded: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']
  const handlers = new Map<NodeJS.Signals, () => void>()

  const onExit = () => {
    try {
      signalGroup(pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }

  const release = () => {
    for (const [signal, handler] of handlers) process.off(signal, handler)
    handlers.clear()
    process.off('exit', onExit)
  }

  for (const signal of forwarded) {
    const handler = () => {
      try {
        signalGroup(pid, signal)
      } catch {
        // Already gone.
      }

      release()

      // Listening took the default exit away, so it is given back.
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal)
    }

    handlers.set(signal, handler)
    process.on(signal, handler)
  }

  process.on('exit', onExit)

  return release
}

export async function runInstall(
  command: string,
  args: string[],
  opts: RunInstallOptions
): Promise<InstallResult> {
  const spawnProcess = opts.spawn ?? spawn
  const platform = opts.platform ?? process.platform
  const timeoutMs = opts.timeoutMs ?? installTimeoutMs()
  const tee = opts.stdio === 'tee'
  // Its own group, so a timeout reaches what the manager started. Not when
  // stdin is the terminal's: a background group that reads it is stopped.
  const ownGroup =
    platform !== 'win32' && opts.stdio !== 'inherit' && opts.stdio !== 'tee'
  const child = spawnProcess(command, args, {
    // A captured run has no one to answer a prompt, so its stdin is closed
    // and a manager that asks reads the end at once, not at the timeout.
    stdio:
      opts.stdio === 'tee'
        ? ['inherit', 'pipe', 'pipe']
        : opts.stdio === 'pipe'
          ? ['ignore', 'pipe', 'pipe']
          : opts.stdio,
    cwd: opts.cwd,
    // cross-spawn runs the .cmd shims on Windows and escapes each argument,
    // so the project path never becomes part of a shell string.
    env: buildExecEnv(process.env, opts.cwd, platform) as NodeJS.ProcessEnv,
    ...(ownGroup ? {detached: true} : {})
  })
  // A stand-in spawn has no real group, so only a given signaler reaches one.
  const signalGroup = ownGroup
    ? (opts.signalGroup ?? (opts.spawn ? undefined : signalProcessGroup))
    : undefined

  const release =
    signalGroup && child.pid !== undefined
      ? forwardEndingSignals(child.pid, signalGroup)
      : () => {}

  let stdout = ''
  let stderr = ''

  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      if (tee) process.stdout.write(chunk)
    })
  }

  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (tee) process.stderr.write(chunk)
    })
  }

  return new Promise<InstallResult>((resolve, reject) => {
    // Resolved here and not on close: a surviving grandchild can hold the
    // pipes open, and close would then never arrive.
    const timer = setTimeout(() => {
      release()
      endProcessTree(child, spawnProcess, platform, signalGroup, () => {
        resolve({
          code: null,
          stderr,
          stdout,
          reason: installTimedOutReason(timeoutMs)
        })
      })

      // Neither the pipes a surviving grandchild holds nor the child itself
      // may keep the create from ending, as the probe and the clone do.
      child.stdout?.destroy()
      child.stderr?.destroy()
      child.unref()
    }, timeoutMs)

    child.on('close', (code, signal) => {
      clearTimeout(timer)
      release()
      resolve({
        code,
        stderr,
        stdout,
        ...(code === null && signal ? {signal} : {})
      })
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      release()
      reject(error)
    })
  })
}
