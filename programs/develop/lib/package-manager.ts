// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {
  execFileSync,
  spawn,
  spawnSync as spawnSyncImported
} from 'node:child_process'
import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {buildExecEnv, detectPackageManagerFromLockfile} from 'prefers-yarn'

// buildExecEnv and lockfile sniffing come from prefers-yarn; the resolver
// stays local because it honors EXTENSION_JS_* overrides.
export {buildExecEnv}

const require = createRequire(import.meta.url)

import type {SUPPORTED_PACKAGE_MANAGERS} from './constants'

export type PackageManagerName = (typeof SUPPORTED_PACKAGE_MANAGERS)[number]

export type PackageManagerResolution = {
  name: PackageManagerName
  execPath?: string
  runnerCommand?: string
  runnerArgs?: string[]
}

type ExecOptions = {
  cwd?: string
  stdio?: 'inherit' | 'ignore' | 'pipe'
  env?: Record<string, string>
}

function normalizePackageManager(
  value?: string
): PackageManagerName | undefined {
  if (!value) return undefined

  const lower = value.toLowerCase().trim()

  if (lower === 'pnpm') return 'pnpm'
  if (lower === 'yarn') return 'yarn'
  if (lower === 'bun') return 'bun'
  if (lower === 'npm') return 'npm'
  if (lower === 'deno') return 'deno'

  return undefined
}

function inferPackageManagerFromPath(
  value?: string
): PackageManagerName | undefined {
  if (!value) return undefined

  const lower = value.toLowerCase()

  if (lower.includes('pnpm')) return 'pnpm'
  if (lower.includes('yarn')) return 'yarn'
  if (lower.includes('bun')) return 'bun'
  if (lower.includes('npm')) return 'npm'

  return undefined
}

function getPackageManagerOverride(): PackageManagerResolution | undefined {
  const name = normalizePackageManager(process.env.EXTENSION_JS_PACKAGE_MANAGER)
  const execPath =
    process.env.EXTENSION_JS_PM_EXEC_PATH ||
    process.env.npm_execpath ||
    process.env.NPM_EXEC_PATH

  if (!name && !execPath) return undefined
  const inferredName = name || inferPackageManagerFromPath(execPath) || 'npm'

  return {name: inferredName, execPath}
}

function detectPackageManagerFromEnv(): PackageManagerResolution | undefined {
  const userAgent = process.env.npm_config_user_agent || ''
  const execPath = process.env.npm_execpath || process.env.NPM_EXEC_PATH || ''
  if (userAgent.includes('pnpm')) {
    return {name: 'pnpm', execPath: execPath || undefined}
  }
  if (userAgent.includes('yarn')) {
    return {name: 'yarn', execPath: execPath || undefined}
  }
  if (userAgent.includes('bun')) {
    return {name: 'bun', execPath: execPath || undefined}
  }
  if (userAgent.includes('npm')) {
    return {name: 'npm', execPath: execPath || undefined}
  }

  if (execPath) {
    const inferred = inferPackageManagerFromPath(execPath) || 'npm'
    return {name: inferred, execPath}
  }

  return undefined
}

function resolveNpmCliFromNode(execPath: string): string | undefined {
  const execDir = path.dirname(execPath)
  const candidates = [
    path.join(execDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(execDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(execDir, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return undefined
}

function resolveBundledNpmCliPath(): string | undefined {
  if (process.env.EXTENSION_JS_PM_EXEC_PATH) {
    const overridePath = process.env.EXTENSION_JS_PM_EXEC_PATH

    if (overridePath && fs.existsSync(overridePath)) return overridePath
  }

  try {
    const resolved = require.resolve('npm/bin/npm-cli.js', {
      paths: [process.cwd(), __dirname]
    })

    if (resolved && fs.existsSync(resolved)) return resolved
  } catch {
    // Ignore
  }
  return resolveNpmCliFromNode(process.execPath)
}

function isWindowsExecutablePath(value?: string) {
  if (!value || process.platform !== 'win32') return false

  return /\.(cmd|bat|exe)$/i.test(value)
}

function isNodeScriptPath(value?: string) {
  if (!value) return false

  return /\.(mjs|cjs|js)$/i.test(value)
}

function resolveWindowsCommandPath(command: string) {
  if (process.platform !== 'win32') return undefined

  try {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows'
    const whereExe = path.join(systemRoot, 'System32', 'where.exe')
    const whereCommand = fs.existsSync(whereExe) ? whereExe : 'where'
    const output = execFileSync(whereCommand, [command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    })
    const candidates = String(output)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    const cmdMatch = candidates.find((line) => /\.cmd$/i.test(line))

    return cmdMatch || candidates[0]
  } catch {
    return undefined
  }
}

function resolveUnixCommandPath(command: string) {
  if (process.platform === 'win32') return undefined

  try {
    const output = execFileSync('which', [command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })

    const candidate = String(output).trim()

    return candidate || undefined
  } catch {
    return undefined
  }
}

function resolveCommandOnPath(command: string) {
  return (
    resolveWindowsCommandPath(command) ||
    resolveUnixCommandPath(command) ||
    undefined
  )
}

function canRunCorepack(): boolean {
  try {
    const spawnSync = spawnSyncImported
    const result = spawnSync('corepack', ['--version'], {
      stdio: 'ignore',
      windowsHide: true,
      // corepack is a .cmd shim on Windows, so a bare spawn never finds it.
      shell: process.platform === 'win32'
    })
    return result?.status === 0
  } catch {
    return false
  }
}

function hydrateResolvedPackageManager(
  name: PackageManagerName
): PackageManagerResolution | undefined {
  const resolvedCommand = resolveCommandOnPath(name)
  if (resolvedCommand) {
    return {name, execPath: resolvedCommand}
  }

  if (name === 'npm') {
    const bundledNpmCli = resolveBundledNpmCliPath()
    if (bundledNpmCli) {
      return {
        name: 'npm',
        execPath: bundledNpmCli,
        runnerCommand: process.execPath,
        runnerArgs: [bundledNpmCli]
      }
    }
  }

  return undefined
}

// Deno-managed: deno.lock, or deno.json(c) with no package.json beside it;
// npm-family lockfiles (checked first) still win for hybrids.
function detectDenoProject(cwd?: string): PackageManagerResolution | undefined {
  if (!cwd) return undefined

  try {
    const hasDenoLock = fs.existsSync(path.join(cwd, 'deno.lock'))
    const hasDenoConfig =
      fs.existsSync(path.join(cwd, 'deno.jsonc')) ||
      fs.existsSync(path.join(cwd, 'deno.json'))
    const hasPackageJson = fs.existsSync(path.join(cwd, 'package.json'))

    if (!hasDenoLock && !(hasDenoConfig && !hasPackageJson)) return undefined
  } catch {
    return undefined
  }

  const execPath = resolveCommandOnPath('deno')
  if (execPath) return {name: 'deno', execPath}

  // Deno-created projects may run dev/build through a node CLI later; only
  // claim deno when the binary is actually available.
  return undefined
}

export function resolvePackageManager(opts?: {
  cwd?: string
}): PackageManagerResolution {
  const lockPm = detectPackageManagerFromLockfile(opts?.cwd)
  if (lockPm) {
    const hydrated = hydrateResolvedPackageManager(lockPm)
    if (hydrated) return hydrated
    return {name: lockPm}
  }

  const override = getPackageManagerOverride()
  if (override) return override

  const denoPm = detectDenoProject(opts?.cwd)
  if (denoPm) return denoPm

  const envPm = detectPackageManagerFromEnv()
  if (envPm) return envPm

  const candidates: PackageManagerName[] = ['pnpm', 'yarn', 'bun']
  for (const candidate of candidates) {
    const resolved = resolveCommandOnPath(candidate)
    if (resolved) {
      return {name: candidate, execPath: resolved}
    }
  }

  const corepackPath = resolveCommandOnPath('corepack')
  if (corepackPath || canRunCorepack()) {
    return {
      name: 'pnpm',
      runnerCommand: corepackPath || 'corepack',
      runnerArgs: ['pnpm']
    }
  }
  const bundledNpmCli = resolveBundledNpmCliPath()
  if (bundledNpmCli) {
    return {
      name: 'npm',
      execPath: bundledNpmCli,
      runnerCommand: process.execPath,
      runnerArgs: [bundledNpmCli]
    }
  }

  return {name: 'npm'}
}

// Confine a project install to the project dir: pnpm walks up and would
// install an unrelated ancestor workspace; skip only when it is the project's own.
export function projectInstallArgs(
  pm: PackageManagerResolution,
  projectDir: string
): string[] {
  if (pm.name !== 'pnpm') return []
  if (fs.existsSync(path.join(projectDir, 'pnpm-workspace.yaml'))) return []

  try {
    const raw = fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw)
    const depFields = [
      pkg.dependencies,
      pkg.devDependencies,
      pkg.optionalDependencies,
      pkg.peerDependencies
    ]
    for (const deps of depFields) {
      if (!deps) continue
      for (const spec of Object.values(deps)) {
        if (typeof spec === 'string' && spec.startsWith('workspace:')) {
          return []
        }
      }
    }
  } catch {
    // Unreadable package.json. The install will surface its own error.
  }

  return ['--ignore-workspace']
}

export type PnpmWorkspaceMember = {
  root: string
  relativeDir: string
}

// Nearest dir holding pnpm-workspace.yaml, the project dir included. A .git
// dir met on the way up is the project's own repository, so a workspace file
// above it belongs to somebody else.
export function findPnpmWorkspaceRoot(startDir: string): string | undefined {
  let current = path.resolve(startDir)
  while (true) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current
    }
    if (fs.existsSync(path.join(current, '.git'))) return undefined
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function cleanYamlListItem(value: string): string {
  const trimmed = value.trim()
  const quoted = /^(['"])(.*?)\1/.exec(trimmed)
  if (quoted) return quoted[2].trim()
  return trimmed.replace(/\s+#.*$/, '').trim()
}

// The `packages` globs of pnpm-workspace.yaml, block or flow style. pnpm
// reads the file with a full YAML parser, this only needs that one list.
export function readPnpmWorkspacePackages(workspaceRoot: string): string[] {
  let raw: string
  try {
    raw = fs.readFileSync(
      path.join(workspaceRoot, 'pnpm-workspace.yaml'),
      'utf8'
    )
  } catch {
    return []
  }

  const lines = raw.split(/\r?\n/)
  const patterns: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const key = /^packages\s*:(.*)$/.exec(lines[i])
    if (!key) continue

    const inline = key[1].trim()
    if (inline.startsWith('[')) {
      let flow = inline
      let j = i
      while (!flow.includes(']') && j + 1 < lines.length) {
        j++
        flow += lines[j]
      }
      const body = flow.slice(1, flow.indexOf(']'))
      for (const item of body.split(',')) {
        const value = cleanYamlListItem(item)
        if (value) patterns.push(value)
      }
      break
    }

    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]
      if (!line.trim() || line.trim().startsWith('#')) continue
      const item = /^\s+-\s*(.+)$/.exec(line)
      if (!item) break
      const value = cleanYamlListItem(item[1])
      if (value) patterns.push(value)
    }
    break
  }
  return patterns
}

// Enough of the glob grammar for workspace member lists: `*` within one
// path segment, `**` across segments, `?` for one character.
function workspaceGlobToRegExp(pattern: string): RegExp {
  let source = '^'
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '*' && pattern[i + 1] === '*') {
      const spansSegments = pattern[i + 2] === '/'
      source += spansSegments ? '(?:.*/)?' : '.*'
      i += spansSegments ? 2 : 1
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`${source}$`)
}

export function isPnpmWorkspaceMemberDir(
  patterns: string[],
  relativeDir: string
): boolean {
  const target = relativeDir.split(path.sep).join('/')
  let included = false
  for (const raw of patterns) {
    const negated = raw.startsWith('!')
    const glob = (negated ? raw.slice(1) : raw)
      .replace(/^\.\//, '')
      .replace(/\/+$/, '')
    if (!workspaceGlobToRegExp(glob).test(target)) continue
    // pnpm feeds negations to the matcher as ignores, so one exclusion wins
    // over every inclusion whatever the list order.
    if (negated) return false
    included = true
  }
  return included
}

// The project is a member when an ancestor workspace file lists its dir.
// The workspace root itself and a project no pattern names both come back
// undefined, so the caller keeps confining the install to the project.
export function findPnpmWorkspaceMember(
  projectDir: string
): PnpmWorkspaceMember | undefined {
  const root = findPnpmWorkspaceRoot(projectDir)
  if (!root) return undefined

  const resolvedProject = path.resolve(projectDir)
  if (root === resolvedProject) return undefined

  const relativeDir = path
    .relative(root, resolvedProject)
    .split(path.sep)
    .join('/')
  if (!isPnpmWorkspaceMemberDir(readPnpmWorkspacePackages(root), relativeDir)) {
    return undefined
  }
  return {root, relativeDir}
}

export type ProjectInstallTarget = {cwd: string; args: string[]}

// Where an auto-install runs and what confines it. A pnpm workspace member
// installs from its root, filtered to the member and its workspace
// dependencies, so the lockfile and the linker layout stay the workspace's.
export function projectInstallTarget(
  pm: PackageManagerResolution,
  projectDir: string,
  member: PnpmWorkspaceMember | undefined
): ProjectInstallTarget {
  if (pm.name === 'pnpm' && member) {
    return {
      cwd: member.root,
      args: ['--filter', `{${member.relativeDir}}...`]
    }
  }
  return {cwd: projectDir, args: projectInstallArgs(pm, projectDir)}
}

// Stop auto-installs from running lifecycle scripts: a wild package.json must
// not get code execution. Opt back in with EXTENSION_ALLOW_INSTALL_SCRIPTS=true.
export function installScriptSuppression(pm: PackageManagerResolution): {
  args: string[]
  env: Record<string, string>
} {
  if (process.env.EXTENSION_ALLOW_INSTALL_SCRIPTS === 'true') {
    return {args: [], env: {}}
  }
  if (pm.name === 'deno') return {args: [], env: {}}
  if (pm.name === 'yarn') {
    return {
      args: [],
      env: {YARN_ENABLE_SCRIPTS: 'false', npm_config_ignore_scripts: 'true'}
    }
  }
  return {args: ['--ignore-scripts'], env: {}}
}

// A hydrated npm resolution for fallback installs: PATH npm first, then the
// npm bundled with the running Node.
export function resolveNpmPackageManager(): PackageManagerResolution {
  return hydrateResolvedPackageManager('npm') || {name: 'npm'}
}

export function buildInstallCommand(
  pm: PackageManagerResolution,
  args: string[]
): {command: string; args: string[]} {
  if (pm.runnerCommand) {
    return {
      command: pm.runnerCommand,
      args: [...(pm.runnerArgs || []), ...args]
    }
  }

  if (pm.execPath) {
    if (isWindowsExecutablePath(pm.execPath)) {
      return {command: pm.execPath, args}
    }

    // Keep JS entrypoints under node, but execute native/shell binaries directly.
    if (isNodeScriptPath(pm.execPath)) {
      return {command: process.execPath, args: [pm.execPath, ...args]}
    }

    return {command: pm.execPath, args}
  }

  return {command: pm.name, args}
}

export function buildSpawnInvocation(
  command: string,
  args: string[]
): {command: string; args: string[]} {
  return {command, args}
}

export function execInstallCommand(
  command: string,
  args: string[],
  options?: ExecOptions
): Promise<void> {
  const invocation = buildSpawnInvocation(command, args)
  const env = buildExecEnv()
  const stdio = options?.stdio ?? 'ignore'
  // On Windows, .cmd/.bat must be run with shell (spawn EINVAL otherwise)
  const useShell =
    process.platform === 'win32' && /\.(cmd|bat)$/i.test(invocation.command)

  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: options?.cwd,
      stdio,
      env: {...(env || process.env), ...options?.env},
      ...(useShell ? {shell: true} : {})
    })

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Install failed with exit code ${code}`))
      } else {
        resolve()
      }
    })

    child.on('error', (error) => reject(error))
  })
}
