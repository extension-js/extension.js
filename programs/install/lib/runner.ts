//  ██╗███╗   ██╗███████╗████████╗ █████╗ ██╗     ██╗
//  ██║████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██║     ██║
//  ██║██╔██╗ ██║███████╗   ██║   ███████║██║     ██║
//  ██║██║╚██╗██║╚════██║   ██║   ██╔══██║██║     ██║
//  ██║██║ ╚████║███████║   ██║   ██║  ██║███████╗███████╗
//  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {
  type ChildProcess,
  type SpawnOptions,
  spawnSync
} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {StringDecoder} from 'node:string_decoder'
import {spawn} from 'cross-spawn'
import type {InstallBrowserTarget} from './browser-target'
import {resolveBrowsersCacheRoot} from './cache-root'
import {corepackRegistryEnv} from './corepack-registry'
import {
  PLAYWRIGHT_VERSION,
  PUPPETEER_BROWSERS_VERSION
} from './installer-versions'
import {isMachineOutput} from './messaging'

type PackageManagerName = 'pnpm' | 'yarn' | 'bun' | 'npm'

interface PackageManager {
  name: PackageManagerName
  major: number | null
}

type PackageRunner = 'pnpm' | 'bunx' | 'yarn' | 'npx'

type Env = Record<string, string | undefined>

// Only Windows is rewritten, so the Windows path rules are the ones that
// apply whichever host decides it.
export function buildExecEnv(
  base: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath
): NodeJS.ProcessEnv {
  if (platform !== 'win32') return base

  const nodeDir = path.win32.dirname(execPath)
  const pathSep = path.win32.delimiter
  const existing = String(base.PATH || base.Path || '').trim()

  // Windows compares folders without case and with or without the last slash,
  // and a longer folder that starts with the same letters is another folder.
  const withoutLastSlashes = (entry: string) => {
    let end = entry.length

    while (end > 0 && entry[end - 1] === '\\') end--

    return entry.slice(0, end)
  }

  const same = (entry: string) =>
    withoutLastSlashes(entry.trim()).toLowerCase() === nodeDir.toLowerCase()

  if (existing.split(pathSep).some(same)) return base

  const updated = existing ? `${nodeDir}${pathSep}${existing}` : nodeDir

  return {
    ...base,
    PATH: updated,
    Path: updated
  }
}

function readMajorVersion(
  userAgent: string,
  name: PackageManagerName
): number | null {
  const match = userAgent.match(new RegExp(`${name}/(\\d+)`))

  return match ? Number(match[1]) : null
}

function detectCurrentPackageManager(env: Env): PackageManager {
  const userAgent = String(env.npm_config_user_agent || '').toLowerCase()

  for (const name of ['pnpm', 'yarn', 'bun', 'npm'] as const) {
    if (userAgent.includes(name)) {
      return {name, major: readMajorVersion(userAgent, name)}
    }
  }

  return {
    name: packageManagerFromExecPath(
      String(env.npm_execpath || env.NPM_EXEC_PATH || '')
    ),
    major: null
  }
}

// A manager sets npm_execpath to its own entry file: npm-cli.js, pnpm.cjs,
// yarn.js or a Berry release such as yarn-4.1.0.cjs, and bun to its binary.
const EXEC_PATH_MANAGERS: Array<[RegExp, PackageManagerName]> = [
  [/^pnp[mx]$/, 'pnpm'],
  [/^yarn(-\d[\w.-]*)?$/, 'yarn'],
  [/^bunx?$/, 'bun']
]

// Only the file's own name is read. A folder on the way to it, such as a
// home under /home/ubuntu, says nothing about which manager is running.
export function packageManagerFromExecPath(
  execPath: string
): PackageManagerName {
  const base = execPath.split(/[\\/]/).pop() || ''
  const stem = base.toLowerCase().replace(/\.(?:[cm]?js|cmd|exe|ps1)$/, '')

  for (const [pattern, name] of EXEC_PATH_MANAGERS) {
    if (pattern.test(stem)) return name
  }

  return 'npm'
}

// Yarn Berry ships `yarn dlx`, Yarn Classic has no package runner at all, so a
// classic project (or a yarn whose version the user agent does not name) falls
// back to npx like npm does.
function currentPackageRunner(env: Env): PackageRunner {
  const {name, major} = detectCurrentPackageManager(env)

  if (name === 'pnpm') return 'pnpm'
  if (name === 'bun') return 'bunx'
  if (name === 'yarn' && major !== null && major >= 2) return 'yarn'

  return 'npx'
}

export interface InstallPlanOptions {
  env?: Record<string, string | undefined>
  platform?: NodeJS.Platform
  cwd?: string
}

export interface InstallPlan {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  cwd: string
}

function installArgs(
  runner: PackageRunner,
  target: InstallBrowserTarget,
  destination: string
): string[] {
  const packageRunnerPrefix =
    runner === 'pnpm' || runner === 'yarn'
      ? ['dlx']
      : runner === 'bunx'
        ? []
        : ['-y']

  if (target === 'edge') {
    return [
      ...packageRunnerPrefix,
      `playwright@${PLAYWRIGHT_VERSION}`,
      'install',
      'msedge'
    ]
  }

  // Puppeteer resolves a bare "firefox" to Nightly, so pin the release
  // channel the same way Chrome is pinned to stable.
  const browserRef =
    target === 'chrome'
      ? 'chrome@stable'
      : target === 'firefox'
        ? 'firefox@stable'
        : target

  return [
    ...packageRunnerPrefix,
    `@puppeteer/browsers@${PUPPETEER_BROWSERS_VERSION}`,
    'install',
    browserRef,
    '--path',
    destination
  ]
}

function resolveInstall(
  target: InstallBrowserTarget,
  destination: string,
  options: InstallPlanOptions
): {runner: PackageRunner; plan: InstallPlan} {
  const {
    env = process.env,
    platform = process.platform,
    cwd = process.cwd()
  } = options
  const runner = currentPackageRunner(env)
  const childEnv = withCorepackRegistry(env, cwd)

  return {
    runner,
    plan: {
      command: platform === 'win32' ? `${runner}.cmd` : runner,
      args: installArgs(runner, target, destination),
      env:
        target === 'edge'
          ? {...childEnv, PLAYWRIGHT_BROWSERS_PATH: destination}
          : childEnv,
      // npm validates the project's devEngines before npx runs anything, so a
      // project that pins another manager refuses npx from inside it.
      cwd: runner === 'npx' ? resolveBrowsersCacheRoot(env, platform, cwd) : cwd
    }
  }
}

// Reads the project's .npmrc and writes nothing, so the whole install can be
// decided from an environment, a platform and a working directory.
export function installPlan(
  target: InstallBrowserTarget,
  destination: string,
  options: InstallPlanOptions = {}
): InstallPlan {
  return resolveInstall(target, destination, options).plan
}

// npx starts in the browsers cache root, which sits outside every project
// and which a first install has not created yet.
export function prepareInstall(
  target: InstallBrowserTarget,
  destination: string,
  options: InstallPlanOptions = {}
): InstallPlan {
  const {runner, plan} = resolveInstall(target, destination, options)

  if (runner === 'npx') fs.mkdirSync(plan.cwd, {recursive: true})

  return plan
}

export function browserInstallCommand(target: InstallBrowserTarget): string {
  return installPlan(target, '').command
}

export function browserInstallCwd(): string {
  return prepareInstall('chromium', '').cwd
}

export function browserInstallArgs(
  target: InstallBrowserTarget,
  destination: string
): string[] {
  return installPlan(target, destination).args
}

export function browserInstallEnv(
  target: InstallBrowserTarget,
  destination: string
): NodeJS.ProcessEnv {
  return installPlan(target, destination).env
}

// A Windows child keeps one casing per variable name, so every casing of the
// Corepack variable leaves before the pin is spread over the inherited set.
function withCorepackRegistry(
  base: Env,
  projectDir: string
): NodeJS.ProcessEnv {
  const pin = corepackRegistryEnv(base, projectDir)
  const env = {...base}

  if (pin.COREPACK_NPM_REGISTRY) {
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === 'corepack_npm_registry') {
        Reflect.deleteProperty(env, key)
      }
    }
  }

  return {...env, ...pin} as NodeJS.ProcessEnv
}

export interface CommandResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  // Set when the runner ended the child itself, at the timeout.
  timedOut?: boolean
  // Set when the runner ended the child because sudo's password prompt
  // went unanswered for the whole of promptWaitMs.
  promptTimedOut?: boolean
  // The signal this process received and passed on to the child.
  interrupted?: NodeJS.Signals
}

// A runner that asks a question reads the end of input and fails at once,
// where an open pipe would leave it waiting for an answer for ever.
const NO_INPUT: ['ignore', 'pipe', 'pipe'] = ['ignore', 'pipe', 'pipe']
const DEFAULT_INSTALL_TIMEOUT_MS = 30 * 60_000
// A longer delay overflows the timer and fires at once.
const LONGEST_TIMER_MS = 2_147_483_647
// How long a child gets to end on SIGTERM before the group is killed.
const KILL_GRACE_MS = 2_000
// How long the runner waits for the pipes to close after the kill.
const KILL_SETTLE_MS = 1_000

// sudo's own default for how long it waits for a password.
export const PRIVILEGE_PROMPT_WAIT_MS = 5 * 60_000
// Playwright prints this line just before it runs sudo or su, which then ask
// on the terminal, where no pipe of ours sees the prompt.
const ROOT_SWITCH_LINE = /^Switching to root user\b.*\r?\n/m
// Enough of what came before a chunk to find the line split across two.
const ROOT_SWITCH_OVERLAP = 64

// Every process as ps lists it, a pid beside its parent's pid.
export function parseProcessTable(text: string): Array<[number, number]> {
  const rows: Array<[number, number]> = []

  for (const line of String(text || '').split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
    if (match) rows.push([Number(match[1]), Number(match[2])])
  }

  return rows
}

// Every process under root, nearest first. A pid seen twice is skipped, so a
// table read while processes come and go can never loop.
export function descendantsOf(
  root: number,
  table: Array<[number, number]>
): number[] {
  const seen = new Set([root])
  const found: number[] = []
  const queue = [root]

  while (queue.length > 0) {
    const parent = queue.shift() as number

    for (const [pid, ppid] of table) {
      if (ppid !== parent || seen.has(pid)) continue

      seen.add(pid)
      found.push(pid)
      queue.push(pid)
    }
  }

  return found
}

function readProcessTable(): string {
  try {
    const result = spawnSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    })

    return result.status === 0 ? String(result.stdout || '') : ''
  } catch {
    return ''
  }
}

// A whole number of milliseconds only: "30s" or "-1" means the default, never
// a timeout thirty times shorter than the one that was meant.
export function installTimeoutMs(env: Env = process.env): number {
  const text = String(env.EXTENSION_INSTALL_TIMEOUT_MS || '').trim()
  const raw = /^\d+$/.test(text) ? Number(text) : 0

  return raw > 0 ? Math.min(raw, LONGEST_TIMER_MS) : DEFAULT_INSTALL_TIMEOUT_MS
}

type ForwardedSignal = 'SIGINT' | 'SIGTERM'

export interface SignalSource {
  on: (signal: ForwardedSignal, listener: () => void) => unknown
  off: (signal: ForwardedSignal, listener: () => void) => unknown
}

export type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions
) => ChildProcess

export interface RunCommandOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  // Left out, it is read from EXTENSION_INSTALL_TIMEOUT_MS in env.
  timeoutMs?: number
  // False keeps the child on this terminal, for an installer that has sudo
  // ask for a password there. It is then signaled alone, without a group.
  ownGroup?: boolean
  // How long the installer may stay silent after it announces the switch to
  // root, while sudo waits for a password. Left out, there is no such limit.
  promptWaitMs?: number
  graceMs?: number
  platform?: NodeJS.Platform
  signals?: SignalSource
  spawnProcess?: SpawnProcess
}

export async function runCommand(
  command: string,
  args: string[],
  opts: RunCommandOptions
): Promise<CommandResult> {
  const platform = opts.platform ?? process.platform
  const spawnProcess: SpawnProcess = opts.spawnProcess ?? spawn
  const signals: SignalSource = opts.signals ?? process
  const timeoutMs = Math.min(
    opts.timeoutMs ?? installTimeoutMs(opts.env),
    LONGEST_TIMER_MS
  )
  const graceMs = opts.graceMs ?? KILL_GRACE_MS
  // A new group on Windows opens a console window, and taskkill ends the
  // whole tree there without one.
  const ownGroup = platform !== 'win32' && opts.ownGroup !== false
  const child = spawnProcess(command, args, {
    cwd: opts.cwd,
    env: buildExecEnv(opts.env, platform),
    // cross-spawn runs the .cmd shims on Windows and escapes each argument,
    // so the destination path never becomes part of a shell string.
    stdio: NO_INPUT,
    detached: ownGroup
  })

  // Under machine output stdout carries the envelope alone, so the installer's
  // own progress moves to stderr where a human can still watch it.
  const progress = isMachineOutput() ? process.stderr : process.stdout
  // A character split across two chunks is held until its last byte arrives.
  const stdoutDecoder = new StringDecoder('utf8')
  const stderrDecoder = new StringDecoder('utf8')
  let stdout = ''
  let stderr = ''

  return new Promise((resolve, reject) => {
    let timedOut = false
    let promptTimedOut = false
    let interrupted: ForwardedSignal | undefined
    let killTimer: NodeJS.Timeout | undefined
    let settleTimer: NodeJS.Timeout | undefined
    let promptTimer: NodeJS.Timeout | undefined
    let promptState: 'unannounced' | 'waiting' | 'answered' = opts.promptWaitMs
      ? 'unannounced'
      : 'answered'
    let settled = false
    // Everything found under a child kept on the terminal, kept so the
    // SIGKILL still reaches what the first signal orphaned.
    const below = new Set<number>()

    // A child kept on the terminal leads no group, so what it started, sudo
    // waiting on a password among it, is found through ps one by one.
    const signalTree = (pid: number, signal: NodeJS.Signals) => {
      const table = parseProcessTable(readProcessTable())
      const listed = new Set(table.map(([listedPid]) => listedPid))

      for (const found of descendantsOf(pid, table)) below.add(found)

      for (const found of below) {
        if (!listed.has(found)) continue

        try {
          process.kill(found, signal)
        } catch {
          // Gone already, or run as root and out of reach.
        }
      }
    }

    // The group is signaled by its negative id, so the children a package
    // runner starts for lifecycle scripts end with it.
    const signalChild = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) return

      if (!ownGroup && platform !== 'win32') signalTree(child.pid, signal)

      try {
        if (ownGroup) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch {
        // Already gone, and the ending is still what gets reported.
      }
    }

    const endChild = (signal: NodeJS.Signals) => {
      if (killTimer) return

      if (platform === 'win32' && child.pid !== undefined) {
        // A .cmd shim runs the manager as a grandchild of cmd.exe, which a
        // plain kill would orphan, so Windows ends the whole tree.
        try {
          spawnProcess('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            stdio: 'ignore'
          }).on('error', () => {})
        } catch {
          // The timeout is still what gets reported.
        }
      } else {
        signalChild(signal)
      }

      killTimer = setTimeout(() => {
        signalChild('SIGKILL')
        // A grandchild that left the group can hold the pipes open, and
        // close would then never arrive.
        settleTimer = setTimeout(() => {
          child.stdout?.destroy()
          child.stderr?.destroy()
          finish(null, 'SIGKILL')
        }, KILL_SETTLE_MS)
      }, graceMs)
    }

    // The wait starts at the root-switch line and ends at the next output,
    // which only comes once sudo has its password and the script runs.
    const watchPrompt = (from: 'stdout' | 'stderr', before: number) => {
      if (promptState === 'waiting') {
        promptState = 'answered'
        clearTimeout(promptTimer)

        return
      }

      if (promptState !== 'unannounced' || from !== 'stdout') return

      const recent = stdout.slice(Math.max(0, before - ROOT_SWITCH_OVERLAP))
      const line = ROOT_SWITCH_LINE.exec(recent)

      if (!line) return

      if (recent.slice(line.index + line[0].length).trim()) {
        promptState = 'answered'

        return
      }

      promptState = 'waiting'
      promptTimer = setTimeout(
        () => {
          promptTimedOut = true
          endChild('SIGTERM')
        },
        Math.min(opts.promptWaitMs as number, LONGEST_TIMER_MS)
      )
    }

    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer) => {
        const before = stdout.length

        stdout += stdoutDecoder.write(chunk)
        progress.write(chunk)
        watchPrompt('stdout', before)
      })
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        const before = stderr.length

        stderr += stderrDecoder.write(chunk)
        process.stderr.write(chunk)
        watchPrompt('stderr', before)
      })
    }

    const onInterrupt = () => forward('SIGINT')
    const onTerminate = () => forward('SIGTERM')

    function forward(signal: ForwardedSignal) {
      interrupted = interrupted ?? signal
      endChild(signal)
    }

    const timer = setTimeout(() => {
      timedOut = true
      endChild('SIGTERM')
    }, timeoutMs)

    function cleanUp() {
      settled = true
      clearTimeout(timer)
      clearTimeout(killTimer)
      clearTimeout(settleTimer)
      clearTimeout(promptTimer)
      signals.off('SIGINT', onInterrupt)
      signals.off('SIGTERM', onTerminate)
    }

    function finish(code: number | null, signal: NodeJS.Signals | null) {
      if (settled) return

      // Whatever outlived a stopped leader ignored the first signal.
      if (killTimer) signalChild('SIGKILL')

      cleanUp()
      resolve({
        code,
        signal,
        stdout: stdout + stdoutDecoder.end(),
        stderr: stderr + stderrDecoder.end(),
        ...(timedOut ? {timedOut} : {}),
        ...(promptTimedOut ? {promptTimedOut} : {}),
        ...(interrupted ? {interrupted} : {})
      })
    }

    // A detached child would outlive Ctrl+C, so both signals are passed on
    // for as long as it runs.
    signals.on('SIGINT', onInterrupt)
    signals.on('SIGTERM', onTerminate)

    child.on('close', finish)

    child.on('error', (error) => {
      if (settled) return

      cleanUp()
      reject(error)
    })
  })
}

// Reading process.stdin opens it, so it is read only on Linux and only when
// the caller did not say whether a terminal is attached.
export function edgeInstallNeedsInteractivePrivilegedSession(
  platform: NodeJS.Platform = process.platform,
  stdinIsTTY?: boolean
): boolean {
  return platform === 'linux' && !(stdinIsTTY ?? process.stdin?.isTTY)
}

// The lines sudo and su print when they could not get a password. Playwright
// announces the switch to root before every attempt, so that line says nothing.
const ESCALATION_FAILURES = [
  /^\s*sudo:\s+a password is required/im,
  /^\s*sudo:\s+a terminal is required/im,
  /^\s*sudo:\s+no tty present and no askpass program specified/im,
  /^\s*su:\s+authentication failure/im,
  /^\s*su:\s+must be run from a terminal/im
]

// sudo and su answer on either stream, so the caller hands over both as one.
export function isEdgePrivilegeEscalationFailure(output: string): boolean {
  const text = String(output || '')

  return ESCALATION_FAILURES.some((pattern) => pattern.test(text))
}

export interface SystemEdgeLookup {
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  exists?: (file: string) => boolean
  lookup?: (tool: 'where' | 'which', name: string) => string | null
  registry?: (key: string) => string | null
}

type RunTool = (
  tool: string,
  args: string[]
) => {status: number | null; stdout: string}

function runTool(tool: string, args: string[]) {
  return spawnSync(tool, args, {stdio: 'pipe', encoding: 'utf8'})
}

// Some `which` builds print extra lines, and `where` lists every match. The
// binary path is the first line.
export function lookupOnPath(
  tool: 'where' | 'which',
  name: string,
  run: RunTool = runTool
): string | null {
  const result = run(tool, [name])

  if (result.status !== 0) return null

  const first = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)

  return first || null
}

// The default value of a key, as `reg query <key> /ve` prints it. Windows
// registers each installed program's executable under App Paths this way.
export function queryRegistryDefault(
  key: string,
  run: RunTool = runTool
): string | null {
  const result = run('reg', ['query', key, '/ve'])

  if (result.status !== 0) return null

  const match = /REG_SZ\s+(.+)$/m.exec(String(result.stdout || ''))
  const value = match ? match[1].trim().replace(/^"(.*)"$/, '$1') : ''

  return value || null
}

const EDGE_APP_PATHS_KEY =
  'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe'

// Windows spells these names in mixed case, and a copied environment keeps
// one spelling only, so the name is matched whatever its case.
function readEnv(env: Env, name: string): string {
  const wanted = name.toLowerCase()

  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === wanted) return String(env[key] || '').trim()
  }

  return ''
}

const EDGE_INSTALL_TAIL = ['Microsoft', 'Edge', 'Application', 'msedge.exe']
const MAC_EDGE_APP = 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'

// The files the launcher checks for a stable Edge, in its order. A copy of
// the rules in edge-location, held equal to them by a contract spec.
export function launcherEdgeFiles(
  platform: NodeJS.Platform,
  env: Env,
  home: string = readEnv(env, 'HOME') || os.homedir()
): string[] {
  if (platform === 'darwin') {
    return [
      `/Applications/${MAC_EDGE_APP}`,
      `${path.posix.join(home, 'Applications')}/${MAC_EDGE_APP}`
    ]
  }

  if (platform !== 'win32') return []

  return ['LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)']
    .map((name) => readEnv(env, name))
    .filter(Boolean)
    .map((root) => path.win32.join(root, ...EDGE_INSTALL_TAIL))
}

// The one name the launcher asks PATH for where Edge has no fixed folder.
export const LAUNCHER_EDGE_COMMAND = 'microsoft-edge'

export interface SystemEdge {
  path: string
  // False when only install's wider search found it, so the launcher needs
  // the path handed to it.
  launcherFinds: boolean
}

// The launcher's own places first and in its order, then the ones only the
// install checks: the App Paths key and PATH, where an installer may put it.
export function locateSystemEdge({
  platform = process.platform,
  env = process.env,
  exists = fs.existsSync,
  lookup = lookupOnPath,
  registry = queryRegistryDefault
}: SystemEdgeLookup = {}): SystemEdge | null {
  const pinned = readEnv(env, 'EDGE_BINARY')
  if (pinned && exists(pinned)) return {path: pinned, launcherFinds: true}

  for (const file of launcherEdgeFiles(platform, env)) {
    if (exists(file)) return {path: file, launcherFinds: true}
  }

  if (platform === 'darwin') return null

  if (platform === 'win32') {
    for (const hive of ['HKLM', 'HKCU']) {
      const registered = registry(`${hive}\\${EDGE_APP_PATHS_KEY}`)

      if (registered && exists(registered)) {
        return {path: registered, launcherFinds: false}
      }
    }

    const onPath = lookup('where', 'msedge')

    return onPath ? {path: onPath, launcherFinds: false} : null
  }

  const known = lookup('which', LAUNCHER_EDGE_COMMAND)
  if (known) return {path: known, launcherFinds: true}

  for (const name of ['microsoft-edge-stable', 'msedge']) {
    const found = lookup('which', name)
    if (found) return {path: found, launcherFinds: false}
  }

  return null
}

export function detectSystemEdgeBinary(
  lookup: SystemEdgeLookup = {}
): string | null {
  return locateSystemEdge(lookup)?.path ?? null
}
