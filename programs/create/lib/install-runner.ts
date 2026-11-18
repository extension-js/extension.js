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

// A package manager exports every npm config it read as an npm_config_* variable,
// so the invoking checkout's release-age rule would govern the new project's
// install. The project never agreed to it, and its own .npmrc still wins here.
// A rule the user exported on purpose is theirs and travels through: only a
// value that matches the .npmrc the invoking package manager read is dropped.
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

// The release age the invoking package manager read from a .npmrc, walking
// up from where it was started (INIT_CWD under npm, pnpm and yarn scripts).
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
      const found = readNpmrcReleaseAge(dir)
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
  return `The install did not finish within ${Math.round(ms / 1000)} seconds (EXTENSION_CREATE_INSTALL_TIMEOUT_MS)`
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
  // Why the runner ended the child itself, set only when it did.
  reason?: string
}

export interface RunInstallOptions {
  cwd: string
  // 'tee' shows the child's output as it arrives and still captures it.
  stdio: 'inherit' | 'ignore' | 'pipe' | 'tee'
  timeoutMs?: number
  spawn?: SpawnProcess
  platform?: NodeJS.Platform
}

export type InstallRunner = (
  command: string,
  args: string[],
  opts: RunInstallOptions
) => Promise<InstallResult>

// A .cmd shim runs the manager as a grandchild of cmd.exe, which a plain kill
// would orphan, so Windows ends the whole tree.
export function endProcessTree(
  child: ChildProcess,
  spawnProcess: SpawnProcess,
  platform: NodeJS.Platform
) {
  try {
    if (platform === 'win32' && child.pid !== undefined) {
      spawnProcess('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore'
      }).on('error', () => {})

      return
    }

    child.kill('SIGTERM')
  } catch {
    // The child is already gone, and the timeout is still what gets reported.
  }
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
  const child = spawnProcess(command, args, {
    stdio: opts.stdio === 'tee' ? ['inherit', 'pipe', 'pipe'] : opts.stdio,
    cwd: opts.cwd,
    // cross-spawn runs the .cmd shims on Windows and escapes each argument,
    // so the project path never becomes part of a shell string.
    env: buildExecEnv(process.env, opts.cwd, platform) as NodeJS.ProcessEnv
  })
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
      endProcessTree(child, spawnProcess, platform)
      resolve({
        code: null,
        stderr,
        stdout,
        reason: installTimedOutReason(timeoutMs)
      })
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({code, stderr, stdout})
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}
