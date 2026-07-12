import {
  execFileSync,
  spawn,
  spawnSync as spawnSyncImported
} from 'child_process'
import * as fs from 'fs'
import {createRequire} from 'module'
import * as path from 'path'
import {buildExecEnv, detectPackageManagerFromLockfile} from 'prefers-yarn'

// `buildExecEnv` and lockfile sniffing are shared, behavior-identical helpers
// from the standalone `prefers-yarn` package. The resolver below stays local
// because it honors Extension.js-specific overrides (EXTENSION_JS_*).
export {buildExecEnv}

const require = createRequire(import.meta.url)

export type PackageManagerName = 'pnpm' | 'yarn' | 'npm' | 'bun' | 'deno'

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
    const spawnSync = spawnSyncImported
    const result = spawnSync('corepack', ['--version'], {
      stdio: 'ignore',
      windowsHide: true
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

/**
 * A project is Deno-managed when it carries a deno.lock, or a deno.json(c)
 * with no package.json beside it. npm-family lockfiles (checked before this)
 * still win for hybrid projects — deno.lock alone marks a `deno install`.
 */
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

  // Deno projects created by `deno run npm:extension@latest create` may run
  // dev/build through a node CLI later; only claim deno when the binary is
  // actually available.
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

/**
 * Extra args that confine a *project* dependency install to the project
 * directory. pnpm walks up from cwd and, on finding any ancestor
 * `pnpm-workspace.yaml`, installs that ENTIRE workspace instead of the
 * project — for a project that merely sits under an unrelated monorepo
 * (G28), that installs a foreign codebase's dependency tree. Skip the
 * confinement only when the workspace is genuinely the project's own:
 * the project dir is itself a workspace root, or its package.json uses
 * `workspace:` specifiers (a standalone install could never satisfy those).
 */
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
    // Unreadable package.json — the install will surface its own error.
  }

  return ['--ignore-workspace']
}

/**
 * Args/env that stop an auto-install from running lifecycle scripts
 * (preinstall/postinstall/prepare) — the project being built was never
 * vetted by the user typing an install command, so a wild package.json
 * must not get code execution as a side effect of `extension dev/build`.
 * Matches the pnpm 10 / Bun default. Opt back in with
 * EXTENSION_ALLOW_INSTALL_SCRIPTS=true.
 *
 * yarn needs env instead of a flag: yarn 1 accepts --ignore-scripts but
 * Berry rejects unknown flags outright, and the resolved binary's major
 * is unknowable here. Berry maps YARN_ENABLE_SCRIPTS -> enableScripts;
 * yarn 1 reads npm_config_* and ignores YARN_ENABLE_SCRIPTS. deno install
 * already refuses npm lifecycle scripts unless --allow-scripts is passed.
 */
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

/**
 * A hydrated npm resolution for fallback installs: PATH npm first, then the
 * npm CLI bundled with the running Node.
 */
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
