//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {spawn} from 'cross-spawn'
import {getPackageManagerSpec} from 'prefers-yarn'
import {corepackRegistryEnv} from './corepack-registry'
import {endProcessTree, type SpawnProcess} from './install-runner'

const NODE_PACKAGE_MANAGERS = ['pnpm', 'yarn', 'bun', 'npm'] as const

type NodePackageManager = (typeof NODE_PACKAGE_MANAGERS)[number]

/* @invariant Only the manager that INVOKED this process may answer here. An
 * installed binary, a PATH entry, or an installer variable such as BUN_INSTALL
 * says what the machine has, never what the person typed, and recommending the
 * wrong second step is worse than recommending the default one. */
export function detectPackageManagerFromEnv(): NodePackageManager {
  const userAgent = (process.env.npm_config_user_agent || '').toLowerCase()

  for (const manager of NODE_PACKAGE_MANAGERS) {
    if (userAgent.includes(`${manager}/`)) return manager
  }

  const execPath = (
    process.env.npm_execpath ||
    process.env.NPM_EXEC_PATH ||
    ''
  ).toLowerCase()

  for (const manager of NODE_PACKAGE_MANAGERS) {
    if (execPath.includes(manager)) return manager
  }

  return 'npm'
}

// Deno sets neither npm_config_user_agent nor npm_execpath, so detection would
// fall through to npm; detect Deno via its runtime globals instead.
export function isDenoRuntime(): boolean {
  return (
    typeof (globalThis as {Deno?: unknown}).Deno !== 'undefined' ||
    Boolean((process as {versions?: {deno?: string}}).versions?.deno)
  )
}

// Bun sets neither npm_config_user_agent nor npm_execpath when it executes a
// file directly, so a CLI running ON Bun would otherwise scaffold as npm.
export function isBunRuntime(): boolean {
  return (
    typeof (globalThis as {Bun?: unknown}).Bun !== 'undefined' ||
    Boolean((process as {versions?: {bun?: string}}).versions?.bun)
  )
}

// The package managers a scaffold can be created with; deno is folded in here
// so callers have a single closed set to switch on.
export type ScaffoldPackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'deno'

// Single source of truth for a scaffold's package manager: the runtime first,
// then the pm that invoked this process (a new project's lockfile comes from
// it). `bunx` lands on Node through the shebang and is caught by the env
// instead, so both routes into Bun end up here.
export function resolveScaffoldPackageManager(): ScaffoldPackageManager {
  if (isDenoRuntime()) {
    return 'deno'
  }

  if (isBunRuntime()) {
    return 'bun'
  }

  return detectPackageManagerFromEnv()
}

// The one answer to "which manager does this project use", read once after
// the template lands and threaded to every consumer: the declaration, the
// install, the printed next steps and the value handed back. A starter that
// pins a manager (a packageManager field, or the pnpm workspace file it
// ships) is that manager's project; anything else is the manager that ran
// this process, Deno first.
//
// Bun sits BELOW the pin rather than above it, unlike Deno. A Deno project has
// no package.json to read, so the runtime is the only answer there. A project
// pinned to pnpm is still a pnpm project when the CLI happens to run on Bun.
export function resolveProjectPackageManager(
  projectPath: string
): ScaffoldPackageManager {
  if (isDenoRuntime()) return 'deno'

  const pinned = readPinnedPackageManager(projectPath)
  if (pinned) return pinned

  if (fs.existsSync(path.join(projectPath, 'pnpm-workspace.yaml'))) {
    return 'pnpm'
  }

  if (isBunRuntime()) return 'bun'

  return detectPackageManagerFromEnv()
}

export function readPinnedPackageManager(
  projectPath: string
): NodePackageManager | undefined {
  try {
    const raw = fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8')
    const pin = String(JSON.parse(raw)?.packageManager || '')
    const name = pin.split('@')[0].toLowerCase()

    return (NODE_PACKAGE_MANAGERS as readonly string[]).includes(name)
      ? (name as NodePackageManager)
      : undefined
  } catch {
    return undefined
  }
}

export interface VersionProbeOptions {
  stdio: ['ignore', 'pipe', 'ignore']
  timeout: number
  env: NodeJS.ProcessEnv
  cwd?: string
}

// What one `--version` run came to. A run that outlived its limit carries an
// ETIMEDOUT error, the way a synchronous spawn reports it.
export interface VersionProbeAnswer {
  status: number | null
  stdout: string
  error?: Error
}

export type VersionProbe = (
  command: string,
  args: string[],
  options: VersionProbeOptions
) => VersionProbeAnswer | Promise<VersionProbeAnswer>

// Why no version could be learned, for the line the create prints about it.
export type UndeclaredReason =
  | {kind: 'missing'}
  | {kind: 'timeout'; seconds: number}
  | {kind: 'exit'; code: number}
  | {kind: 'no-version'}
  | {kind: 'spawn'; code: string}

// A manager with no spec comes with the reason, so the create can say it.
// Deno declares no packageManager on purpose and carries neither field.
export interface PackageManagerDeclaration {
  spec?: string
  undeclared?: UndeclaredReason
}

// A cold Windows runner took over 5 s to answer `npm --version` once, so a
// probe that ran out of time is asked one more time with a longer limit.
export const VERSION_PROBE_TIMEOUTS_MS = [5000, 15000] as const

// A whole line that is a version and nothing else. A shim or a wrapper may
// print a notice on stdout around it, and a notice is never the version.
const VERSION_LINE = /^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?)$/

function readVersion(stdout: unknown): string | undefined {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())

  // The version is the last thing a manager prints, after any notice.
  for (const line of lines.reverse()) {
    const match = VERSION_LINE.exec(line)
    if (match) return match[1]
  }

  return undefined
}

function spawnFailure(error: unknown, timeoutMs: number): UndeclaredReason {
  const code = String((error as NodeJS.ErrnoException | undefined)?.code || '')

  if (code === 'ENOENT') return {kind: 'missing'}
  if (code === 'ETIMEDOUT') return {kind: 'timeout', seconds: timeoutMs / 1000}

  return {kind: 'spawn', code: code || 'unknown error'}
}

// Starts the manager and waits without blocking, so the create can say it is
// waiting and can end the whole child tree when the limit runs out.
export function versionProbeWith(
  spawnProcess: SpawnProcess = spawn,
  platform: NodeJS.Platform = process.platform
): VersionProbe {
  return (command, args, options) =>
    new Promise<VersionProbeAnswer>((resolve) => {
      // Windows installs the managers as .cmd shims. cross-spawn resolves the
      // shim itself, so the probe never goes through a shell string.
      const child = spawnProcess(command, args, {
        stdio: options.stdio,
        env: options.env,
        cwd: options.cwd,
        windowsHide: true
      })
      let stdout = ''

      // Answered here and not on close: a child that survives can hold the
      // pipe open, and close would then never arrive.
      const timer = setTimeout(() => {
        endProcessTree(child, spawnProcess, platform)
        // Neither the pipe nor the child may keep the create from ending.
        child.stdout?.destroy()
        child.unref()

        resolve({
          status: null,
          stdout,
          error: Object.assign(new Error(`spawn ${command} ETIMEDOUT`), {
            code: 'ETIMEDOUT'
          })
        })
      }, options.timeout)

      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString()
      })

      child.on('error', (error) => {
        clearTimeout(timer)
        resolve({status: null, stdout, error})
      })

      child.on('close', (status) => {
        clearTimeout(timer)
        resolve({status, stdout})
      })
    })
}

// Where the manager is started. A shim answers for the manifest nearest to
// that folder, so the project is the place to ask from.
export function versionProbeFolder(
  projectPath: string,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  // Windows runs a file named like the manager from the folder it starts
  // in before any on PATH, and a downloaded template must never answer.
  if (platform === 'win32') return undefined

  // A folder that is gone would read as a manager that is missing.
  return fs.existsSync(projectPath) ? projectPath : undefined
}

type ProbeAnswer =
  | {version: string}
  | {failure: UndeclaredReason; askAgain: boolean}

async function askVersion(
  manager: NodePackageManager,
  projectPath: string,
  timeoutMs: number,
  probeVersion: VersionProbe
): Promise<ProbeAnswer> {
  const cwd = versionProbeFolder(projectPath)
  let probe: VersionProbeAnswer

  try {
    probe = await probeVersion(manager, ['--version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
      ...(cwd === undefined ? {} : {cwd}),
      env: {
        ...process.env,
        ...corepackRegistryEnv(process.env, projectPath)
      }
    })
  } catch (error) {
    return {failure: spawnFailure(error, timeoutMs), askAgain: false}
  }

  // A child ended by a signal and no error is the timeout kill on some hosts.
  const failure = probe.error
    ? spawnFailure(probe.error, timeoutMs)
    : probe.status === null
      ? ({kind: 'timeout', seconds: timeoutMs / 1000} as const)
      : probe.status !== 0
        ? ({kind: 'exit', code: probe.status} as const)
        : undefined

  if (failure) return {failure, askAgain: failure.kind === 'timeout'}

  const version = readVersion(probe.stdout)
  if (version) return {version}

  // Silence with a clean exit may be a lost answer. Text is a real one.
  return {
    failure: {kind: 'no-version'},
    askAgain: String(probe.stdout || '').trim() === ''
  }
}

// Told when a probe ran out of time and the manager is being asked again, so
// the create can print why it is still waiting.
export type AskingAgain = (waitedSeconds: number, limitSeconds: number) => void

// The `name@version` the project declares for that manager: the template's
// own pin, else the invoking manager's spec when it is the same manager,
// else the installed binary's version. A host with no user agent still gets
// a usable declaration this way instead of an empty field.
export async function declarePackageManager(
  projectPath: string,
  manager: ScaffoldPackageManager,
  probeVersion: VersionProbe = versionProbeWith(),
  onAskingAgain?: AskingAgain
): Promise<PackageManagerDeclaration> {
  if (manager === 'deno') return {}

  try {
    const raw = fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8')
    const pin = String(JSON.parse(raw)?.packageManager || '')
    if (pin.toLowerCase().startsWith(`${manager}@`)) return {spec: pin}
  } catch {
    // No template pin to keep.
  }

  const fromEnv = getPackageManagerSpec()
  if (fromEnv?.startsWith(`${manager}@`)) return {spec: fromEnv}

  let undeclared: UndeclaredReason = {kind: 'no-version'}

  for (const [attempt, timeoutMs] of VERSION_PROBE_TIMEOUTS_MS.entries()) {
    const answer = await askVersion(
      manager,
      projectPath,
      timeoutMs,
      probeVersion
    )
    if ('version' in answer) return {spec: `${manager}@${answer.version}`}

    undeclared = answer.failure
    if (!answer.askAgain) break

    const nextMs = VERSION_PROBE_TIMEOUTS_MS[attempt + 1]

    // A blank answer comes back at once, so only a wait is worth a line.
    if (nextMs !== undefined && undeclared.kind === 'timeout') {
      onAskingAgain?.(timeoutMs / 1000, nextMs / 1000)
    }
  }

  return {undeclared}
}
