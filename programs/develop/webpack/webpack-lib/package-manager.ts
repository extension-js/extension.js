import * as fs from 'fs'
import * as path from 'path'
import {
  execFileSync,
  spawn,
  spawnSync as spawnSyncImported
} from 'child_process'
import {createRequire} from 'module'

const require = createRequire(import.meta.url)

export type PackageManagerName = 'pnpm' | 'yarn' | 'npm' | 'bun'

export type PackageManagerResolution = {
  name: PackageManagerName
  execPath?: string
  runnerCommand?: string
  runnerArgs?: string[]
}

type ExecOptions = {
  cwd?: string
  stdio?: 'inherit' | 'ignore' | 'pipe'
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
  const execPath = process.env.EXTENSION_JS_PM_EXEC_PATH

  if (!name && !execPath) return undefined
  const inferredName = name || inferPackageManagerFromPath(execPath) || 'npm'

  return {name: inferredName, execPath}
}

function detectPackageManagerFromEnv(): PackageManagerResolution | undefined {
  const userAgent = process.env.npm_config_user_agent || ''
  if (userAgent.includes('pnpm')) return {name: 'pnpm'}
  if (userAgent.includes('yarn')) return {name: 'yarn'}
  if (userAgent.includes('bun')) return {name: 'bun'}
  if (userAgent.includes('npm')) return {name: 'npm'}

  const execPath = process.env.npm_execpath || process.env.NPM_EXEC_PATH || ''
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
    // ignore
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
    const fallback = require('child_process') as typeof import('child_process')
    const spawnSync =
      (spawnSyncImported as any)?.mock !== undefined
        ? spawnSyncImported
        : fallback.spawnSync || spawnSyncImported
    const result = spawnSync('corepack', ['--version'], {
      stdio: 'ignore',
      windowsHide: true
    })
    return result?.status === 0
  } catch {
    return false
  }
}

function detectByLockfile(cwd?: string): PackageManagerName | undefined {
  if (!cwd) return undefined
  const hasPnpmLock = fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))
  const hasYarnLock = fs.existsSync(path.join(cwd, 'yarn.lock'))
  const hasNpmLock = fs.existsSync(path.join(cwd, 'package-lock.json'))
  if (hasPnpmLock) return 'pnpm'
  if (hasYarnLock) return 'yarn'
  if (hasNpmLock) return 'npm'
  return undefined
}

export function resolvePackageManager(opts?: {
  cwd?: string
}): PackageManagerResolution {
  const lockPm = detectByLockfile(opts?.cwd)
  if (lockPm) return {name: lockPm}

  const override = getPackageManagerOverride()
  if (override) return override

  const envPm = detectPackageManagerFromEnv()
  if (envPm) return envPm

  const candidates: PackageManagerName[] = ['pnpm', 'yarn', 'bun']
  for (const candidate of candidates) {
    const resolved = resolveCommandOnPath(candidate)
    if (resolved) {
      if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
        return {name: candidate}
      }
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

export function buildExecEnv(): NodeJS.ProcessEnv | undefined {
  if (process.platform !== 'win32') return undefined

  const nodeDir = path.dirname(process.execPath)
  const pathSep = path.delimiter
  const existing = process.env.PATH || process.env.Path || ''

  if (existing.includes(nodeDir)) return undefined

  return {
    ...process.env,
    PATH: `${nodeDir}${pathSep}${existing}`.trim(),
    Path: `${nodeDir}${pathSep}${existing}`.trim()
  }
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

export function buildNpmCliFallback(
  args: string[]
): {command: string; args: string[]} | undefined {
  const npmCli = resolveBundledNpmCliPath()

  if (!npmCli) return undefined

  return {
    command: process.execPath,
    args: [npmCli, ...args]
  }
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
      env: env || process.env,
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

export function getInstallCommandForPath(cwd: string): PackageManagerName {
  return resolvePackageManager({cwd}).name
}
