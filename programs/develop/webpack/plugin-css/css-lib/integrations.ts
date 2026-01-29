//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {execFileSync, spawnSync} from 'child_process'
import * as messages from './messages'
import {findExtensionDevelopRoot} from '../../webpack-lib/check-build-dependencies'

function parseJsonSafe(text: string) {
  const s = text && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return JSON.parse(s || '{}')
}

function resolveDevelopRootFromDir(dir: string): string | undefined {
  try {
    const packageJsonPath = path.join(dir, 'package.json')
    if (!fs.existsSync(packageJsonPath)) return undefined
    const pkg = parseJsonSafe(fs.readFileSync(packageJsonPath, 'utf8'))
    if (pkg?.name === 'extension-develop') return dir
  } catch {
    return undefined
  }
  return undefined
}

function findDevelopRootFrom(startDir: string): string | undefined {
  let currentDir = startDir
  const maxDepth = 6

  for (let i = 0; i < maxDepth; i++) {
    const root = resolveDevelopRootFromDir(currentDir)

    if (root) return root

    const parent = path.dirname(currentDir)
    if (parent === currentDir) break

    currentDir = parent
  }

  return undefined
}
function isFromPnpx() {
  if (process.env.npm_config_user_agent?.includes('pnpm')) return 'pnpm'
  return false
}

function isFromNpx() {
  if ((process.env as any)['npm_execpath']) return 'npm'
  return false
}

type DetectedPackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun'
type PackageManagerResolution = {
  name: DetectedPackageManager
  execPath?: string
  runnerCommand?: string
  runnerArgs?: string[]
}

function normalizePackageManager(
  value?: string
): DetectedPackageManager | undefined {
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
): DetectedPackageManager | undefined {
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

function getPackageManagerFromEnv(): DetectedPackageManager | undefined {
  const ua = process.env.npm_config_user_agent

  if (ua) {
    if (ua.includes('pnpm')) return 'pnpm'
    if (ua.includes('yarn')) return 'yarn'
    if (ua.includes('bun')) return 'bun'
    if (ua.includes('npm')) return 'npm'
  }

  const execPath = process.env.npm_execpath || process.env.NPM_EXEC_PATH

  if (execPath) {
    if (execPath.includes('pnpm')) return 'pnpm'
    if (execPath.includes('yarn')) return 'yarn'
    if (execPath.includes('bun')) return 'bun'
    if (execPath.includes('npm')) return 'npm'
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

async function resolvePackageManager(): Promise<PackageManagerResolution> {
  console.log('[extension.js][optional-deps] resolvePackageManager start', {
    platform: process.platform,
    execPath: process.execPath,
    npm_execpath: process.env.npm_execpath,
    npm_config_user_agent: process.env.npm_config_user_agent,
    npm_config_prefix: process.env.npm_config_prefix,
    npm_config_cache: process.env.npm_config_cache,
    npm_config_userconfig: process.env.npm_config_userconfig
  })

  const override = getPackageManagerOverride()
  if (override) {
    console.log('[extension.js][optional-deps] using override', override)
    return override
  }

  const envPm = getPackageManagerFromEnv()
  const execPath = process.env.npm_execpath || process.env.NPM_EXEC_PATH
  if (envPm) {
    console.log('[extension.js][optional-deps] using env package manager', {
      envPm,
      execPath
    })
    return {name: envPm, execPath}
  }

  const candidates: DetectedPackageManager[] = ['pnpm', 'yarn', 'npm', 'bun']
  for (const candidate of candidates) {
    if (commandExists(candidate)) {
      console.log('[extension.js][optional-deps] found on PATH', candidate)
      return {name: candidate}
    }
    const windowsPath = resolveWindowsCommandPath(candidate)
    if (windowsPath) {
      console.log('[extension.js][optional-deps] found via where', {
        candidate,
        windowsPath
      })
      return {name: candidate, execPath: windowsPath}
    }
  }

  if (execPath) {
    const inferred: DetectedPackageManager = execPath.includes('pnpm')
      ? 'pnpm'
      : execPath.includes('yarn')
        ? 'yarn'
        : execPath.includes('npm')
          ? 'npm'
          : 'npm'
    const resolution = {name: inferred, execPath}
    console.log('[extension.js][optional-deps] inferred from execPath', {
      execPath,
      resolution
    })
    return resolution
  }

  const bundledNpmCli = resolveBundledNpmCliPath()
  if (bundledNpmCli) {
    console.log('[extension.js][optional-deps] using bundled npm cli', {
      bundledNpmCli
    })
    return {name: 'npm', execPath: bundledNpmCli}
  }

  if (commandExists('corepack')) {
    console.log('[extension.js][optional-deps] using corepack fallback')
    const fallbackChain: DetectedPackageManager[] = ['pnpm', 'yarn', 'npm']
    return {
      name: fallbackChain[0],
      runnerCommand: 'corepack',
      runnerArgs: [fallbackChain[0]]
    }
  }

  console.log('[extension.js][optional-deps] falling back to npm')
  return {name: 'npm'}
}

type InstallCommand = {
  command: string
  args: string[]
}

type WslContext = {
  useWsl: boolean
  distro?: string
  installDir?: string
}

type ExecInstallOptions = {
  cwd?: string
  fallbackNpmCommand?: InstallCommand
}

function commandExists(command: string) {
  try {
    if (shouldUseCmdExe(command)) {
      const cmdExe = resolveWindowsCmdExe()
      const result = spawnSync(
        cmdExe,
        ['/d', '/s', '/c', formatCmdArgs(command, ['-v'])],
        {stdio: 'ignore', windowsHide: true}
      )
      console.log('[extension.js][optional-deps] commandExists', {
        command,
        status: result.status,
        mode: 'cmd'
      })
      return result.status === 0
    }
    const result = spawnSync(command, ['-v'], {stdio: 'ignore'})
    console.log('[extension.js][optional-deps] commandExists', {
      command,
      status: result.status,
      mode: 'direct'
    })
    return result.status === 0
  } catch (error) {
    console.log('[extension.js][optional-deps] commandExists error', {
      command,
      error: (error as Error)?.message || error
    })
    return false
  }
}

function resolveWindowsCommandPath(command: string) {
  if (process.platform !== 'win32') return undefined
  try {
    const cmdExe = resolveWindowsCmdExe()
    const output = execFileSync(
      cmdExe,
      ['/d', '/s', '/c', `where ${command}`],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      }
    )
    const candidates = String(output)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const cmdMatch = candidates.find((line) => /\.cmd$/i.test(line))
    console.log('[extension.js][optional-deps] where results', {
      command,
      candidates
    })
    return cmdMatch || candidates[0]
  } catch (error) {
    console.log('[extension.js][optional-deps] where error', {
      command,
      error: (error as Error)?.message || error
    })
    return undefined
  }
}

function parseWslUncPath(value: string): {distro: string; path: string} | null {
  const match = /^\\\\wsl(?:\.localhost)?\\([^\\]+)\\(.+)$/.exec(value)
  if (!match) return null
  const distro = match[1]
  const rel = match[2].replace(/\\/g, '/').replace(/^\/+/, '')
  const normalized = `/${rel}`

  return {distro, path: normalized}
}

function isWslMountPath(value: string): boolean {
  return /^\/mnt\/[a-z]\//i.test(value)
}

function resolveWslContext(installBaseDir: string): WslContext {
  if (process.platform !== 'win32') return {useWsl: false}
  const trimmed = String(installBaseDir || '').trim()
  if (!trimmed) return {useWsl: false}
  const unc = parseWslUncPath(trimmed)
  if (unc) {
    return {useWsl: true, distro: unc.distro, installDir: unc.path}
  }
  if (isWslMountPath(trimmed)) {
    return {useWsl: true, installDir: trimmed}
  }
  return {useWsl: false}
}

function wrapCommandForWsl(
  command: InstallCommand,
  context: WslContext
): InstallCommand {
  if (!context.useWsl) return command

  const args = [...(context.distro ? ['-d', context.distro] : []), '--']
  args.push(command.command, ...command.args)

  return {command: 'wsl.exe', args}
}

function resolveNpmCmdFromNodeExec(): string | undefined {
  if (process.platform !== 'win32') return undefined
  try {
    const execDir = path.dirname(process.execPath)
    const candidate = path.join(execDir, 'npm.cmd')
    if (fs.existsSync(candidate)) return candidate
    const posixMatch = /^\/([a-z])\//i.exec(execDir)
    if (posixMatch) {
      const drive = posixMatch[1].toUpperCase()
      const winDir = `${drive}:\\${execDir.slice(3).replace(/\//g, '\\')}`
      const winCandidate = path.join(winDir, 'npm.cmd')
      if (fs.existsSync(winCandidate)) return winCandidate
    }
  } catch {
    return undefined
  }
  return undefined
}

function resolveNpmCommand(): string {
  return resolveNpmCmdFromNodeExec() || 'npm'
}

function buildNpmCliFallback(args: string[]): InstallCommand | undefined {
  const npmCli = resolveBundledNpmCliPath()
  if (!npmCli) return undefined
  return {command: process.execPath, args: [npmCli, ...args]}
}

function isMissingManagerError(error: unknown) {
  const err = error as NodeJS.ErrnoException
  return (
    err?.code === 'ENOENT' ||
    String(err?.message || '').includes('ENOENT') ||
    String(err?.message || '').includes('not found')
  )
}

function isWindowsCmd(command: string) {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
}

function resolveWindowsCmdExe(): string {
  if (process.platform !== 'win32') return 'cmd.exe'
  const comspec = process.env.ComSpec
  if (comspec && fs.existsSync(comspec)) return comspec
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const fallback = path.join(systemRoot, 'System32', 'cmd.exe')
  if (fs.existsSync(fallback)) return fallback
  return 'cmd.exe'
}

function formatCmdArgs(command: string, args: string[]) {
  const quotedCommand = command.includes(' ') ? `"${command}"` : command
  const quotedArgs = args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg))
  return `${quotedCommand} ${quotedArgs.join(' ')}`.trim()
}

function shouldUseCmdExe(command: string) {
  if (process.platform !== 'win32') return false
  if (isWindowsCmd(command)) return true
  return ['npm', 'pnpm', 'yarn', 'corepack', 'bun'].includes(command)
}

function isWindowsExecutablePath(value?: string) {
  if (!value || process.platform !== 'win32') return false
  return /\.(cmd|bat|exe)$/i.test(value)
}

function execFileSyncSafe(
  command: string,
  args: string[],
  options: {
    stdio: 'inherit' | 'ignore'
    cwd?: string
  }
) {
  if (shouldUseCmdExe(command)) {
    const cmdExe = resolveWindowsCmdExe()
    execFileSync(cmdExe, ['/d', '/s', '/c', formatCmdArgs(command, args)], {
      ...options,
      windowsHide: true
    })
    return
  }
  try {
    execFileSync(command, args, options)
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (process.platform === 'win32' && err?.code === 'EINVAL') {
      const cmdExe = resolveWindowsCmdExe()
      execFileSync(cmdExe, ['/d', '/s', '/c', formatCmdArgs(command, args)], {
        ...options,
        windowsHide: true
      })
      return
    }
    throw error
  }
}

function execInstallCommand(
  command: InstallCommand,
  options: ExecInstallOptions
) {
  try {
    console.log('[extension.js][optional-deps] exec install', {
      command,
      cwd: options.cwd
    })
    execFileSyncSafe(command.command, command.args, {
      stdio: 'inherit',
      cwd: options.cwd
    })
    return
  } catch (error) {
    if (options.fallbackNpmCommand && isMissingManagerError(error)) {
      console.log('[extension.js][optional-deps] exec fallback npm', {
        fallback: options.fallbackNpmCommand,
        cwd: options.cwd
      })
      execFileSyncSafe(
        options.fallbackNpmCommand.command,
        options.fallbackNpmCommand.args,
        {
          stdio: 'inherit',
          cwd: options.cwd
        }
      )
      return
    }
    throw error
  }
}

export function resolveDevelopInstallRoot(): string | undefined {
  const directRoot = findExtensionDevelopRoot()
  if (directRoot) return directRoot

  try {
    const candidateRoot = findDevelopRootFrom(__dirname)
    if (candidateRoot) return candidateRoot
  } catch {
    // ignore
  }

  try {
    const pkgPath = require.resolve('extension-develop/package.json', {
      paths: [__dirname]
    })
    return resolveDevelopRootFromDir(path.dirname(pkgPath))
  } catch {
    return undefined
  }
}

function maybeWrapExecPath(
  command: InstallCommand,
  pmName: DetectedPackageManager,
  execPath?: string,
  runnerCommand?: string,
  runnerArgs?: string[]
): InstallCommand {
  if (runnerCommand) {
    return {
      command: runnerCommand,
      args: [...(runnerArgs || []), ...command.args]
    }
  }
  if (!execPath) return command
  if (isWindowsExecutablePath(execPath)) {
    return {command: execPath, args: command.args}
  }
  if (commandExists(pmName)) return command

  return {
    command: process.execPath,
    args: [execPath, ...command.args]
  }
}

function getOptionalInstallCommand(
  pm: PackageManagerResolution,
  dependencies: string[],
  installBaseDir: string
): InstallCommand {
  const pmName = pm.name

  if (pmName === 'yarn') {
    return maybeWrapExecPath(
      {
        command: 'yarn',
        args: [
          '--silent',
          'add',
          ...dependencies,
          '--cwd',
          installBaseDir,
          '--optional'
        ]
      },
      pmName,
      pm.execPath,
      pm.runnerCommand,
      pm.runnerArgs
    )
  }

  if (pmName === 'npm' || isFromNpx()) {
    return maybeWrapExecPath(
      {
        command: resolveNpmCommand(),
        args: [
          '--silent',
          'install',
          ...dependencies,
          '--prefix',
          installBaseDir,
          '--save-optional'
        ]
      },
      pmName,
      pm.execPath,
      pm.runnerCommand,
      pm.runnerArgs
    )
  }

  if (pmName === 'pnpm' || isFromPnpx()) {
    return maybeWrapExecPath(
      {
        command: 'pnpm',
        args: [
          'add',
          ...dependencies,
          '--dir',
          installBaseDir,
          '--save-optional',
          '--silent'
        ]
      },
      pmName,
      pm.execPath,
      pm.runnerCommand,
      pm.runnerArgs
    )
  }

  if (pmName === 'bun') {
    return maybeWrapExecPath(
      {
        command: 'bun',
        args: ['add', ...dependencies, '--cwd', installBaseDir, '--optional']
      },
      pmName,
      pm.execPath,
      pm.runnerCommand,
      pm.runnerArgs
    )
  }

  const fallback = pmName || 'npm'
  const resolvedFallback = fallback === 'npm' ? resolveNpmCommand() : fallback
  return maybeWrapExecPath(
    {
      command: resolvedFallback,
      args: [
        '--silent',
        'install',
        ...dependencies,
        '--cwd',
        installBaseDir,
        '--optional'
      ]
    },
    pmName,
    pm.execPath,
    pm.runnerCommand,
    pm.runnerArgs
  )
}

function getRootInstallCommand(
  pm: PackageManagerResolution,
  installBaseDir?: string
): InstallCommand {
  const pmName = pm.name
  const dirArgs = installBaseDir
    ? pmName === 'yarn'
      ? ['--cwd', installBaseDir]
      : pmName === 'pnpm'
        ? ['--dir', installBaseDir]
        : pmName === 'bun'
          ? ['--cwd', installBaseDir]
          : ['--prefix', installBaseDir]
    : []
  if (pmName === 'yarn') {
    return maybeWrapExecPath(
      {command: 'yarn', args: ['install', '--silent', ...dirArgs]},
      pmName,
      pm.execPath,
      pm.runnerCommand,
      pm.runnerArgs
    )
  }

  if (pmName === 'npm' || isFromNpx()) {
    return maybeWrapExecPath(
      {command: resolveNpmCommand(), args: ['install', '--silent', ...dirArgs]},
      pmName,
      pm.execPath,
      pm.runnerCommand,
      pm.runnerArgs
    )
  }

  if (pmName === 'pnpm' || isFromPnpx()) {
    return maybeWrapExecPath(
      {command: 'pnpm', args: ['install', '--silent', ...dirArgs]},
      pmName,
      pm.execPath,
      pm.runnerCommand,
      pm.runnerArgs
    )
  }

  if (pmName === 'bun') {
    return maybeWrapExecPath(
      {command: 'bun', args: ['install', ...dirArgs]},
      pmName,
      pm.execPath,
      pm.runnerCommand,
      pm.runnerArgs
    )
  }

  const resolvedFallback =
    (pmName || 'npm') === 'npm' ? resolveNpmCommand() : pmName || 'npm'
  return maybeWrapExecPath(
    {command: resolvedFallback, args: ['install', '--silent', ...dirArgs]},
    pmName,
    pm.execPath,
    pm.runnerCommand,
    pm.runnerArgs
  )
}

export async function installOptionalDependencies(
  integration: string,
  dependencies: string[]
) {
  if (!dependencies.length) return

  let pm: PackageManagerResolution | undefined
  let wslContext: WslContext | undefined
  let installBaseDir: string | undefined

  try {
    pm = await resolvePackageManager()
    installBaseDir = resolveDevelopInstallRoot()
    if (!installBaseDir) {
      throw new Error(messages.optionalInstallRootMissing(integration))
    }
    wslContext = resolveWslContext(installBaseDir)
    const installCommand = getOptionalInstallCommand(
      pm,
      dependencies,
      wslContext.installDir || installBaseDir
    )
    const execCommand = wrapCommandForWsl(installCommand, wslContext)
    const fallbackNpmCommand = wslContext.useWsl
      ? undefined
      : buildNpmCliFallback([
          '--silent',
          'install',
          ...dependencies,
          '--prefix',
          installBaseDir,
          '--save-optional'
        ])

    const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
    console.log(
      messages.optionalToolingSetup([integration], integration, isAuthor)
    )

    execInstallCommand(execCommand, {
      cwd: wslContext.useWsl ? undefined : installBaseDir,
      fallbackNpmCommand
    })
    await new Promise((resolve) => setTimeout(resolve, 500))

    if (isAuthor) {
      console.log(messages.optionalToolingRootInstall(integration))
      const rootInstall = getRootInstallCommand(
        pm,
        wslContext.useWsl ? wslContext.installDir : undefined
      )
      const rootCommand = wrapCommandForWsl(rootInstall, wslContext)
      const rootFallbackCommand = wslContext.useWsl
        ? undefined
        : buildNpmCliFallback([
            '--silent',
            'install',
            '--prefix',
            installBaseDir
          ])
      execInstallCommand(rootCommand, {
        cwd: wslContext.useWsl ? undefined : installBaseDir,
        fallbackNpmCommand: rootFallbackCommand
      })
      console.log(messages.optionalToolingReady(integration))
    }
    return true
  } catch (error) {
    console.error('[extension.js][optional-deps] debug', {
      platform: process.platform,
      execPath: process.execPath,
      cwd: process.cwd(),
      path: process.env.PATH || process.env.Path,
      comspec: process.env.ComSpec,
      systemRoot: process.env.SystemRoot,
      npm_execpath: process.env.npm_execpath,
      npm_config_user_agent: process.env.npm_config_user_agent,
      npm_config_prefix: process.env.npm_config_prefix,
      npm_config_cache: process.env.npm_config_cache,
      npm_config_userconfig: process.env.npm_config_userconfig,
      installBaseDir,
      wslContext,
      pm
    })
    const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
    if (isMissingManagerError(error)) {
      console.error(messages.optionalInstallManagerMissing(integration))
    } else {
      console.error(
        messages.optionalInstallFailed(integration, error, isAuthor)
      )
    }
    return false
  }
}

export async function installOptionalDependenciesBatch(
  integration: string,
  dependencies: string[],
  integrations?: string[]
) {
  if (!dependencies.length) return

  let pm: PackageManagerResolution | undefined
  let wslContext: WslContext | undefined
  let installBaseDir: string | undefined

  try {
    pm = await resolvePackageManager()
    installBaseDir = resolveDevelopInstallRoot()
    if (!installBaseDir) {
      throw new Error(messages.optionalInstallRootMissing(integration))
    }
    wslContext = resolveWslContext(installBaseDir)
    const installCommand = getOptionalInstallCommand(
      pm,
      dependencies,
      wslContext.installDir || installBaseDir
    )
    const execCommand = wrapCommandForWsl(installCommand, wslContext)
    const fallbackNpmCommand = wslContext.useWsl
      ? undefined
      : buildNpmCliFallback([
          '--silent',
          'install',
          ...dependencies,
          '--prefix',
          installBaseDir,
          '--save-optional'
        ])

    const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
    console.log(
      messages.optionalToolingSetup(integrations, integration, isAuthor)
    )

    execInstallCommand(execCommand, {
      cwd: wslContext.useWsl ? undefined : installBaseDir,
      fallbackNpmCommand
    })
    await new Promise((resolve) => setTimeout(resolve, 500))

    if (isAuthor) {
      console.log(messages.optionalToolingRootInstall(integration))
      const rootInstall = getRootInstallCommand(
        pm,
        wslContext.useWsl ? wslContext.installDir : undefined
      )
      const rootCommand = wrapCommandForWsl(rootInstall, wslContext)

      const rootFallbackCommand = wslContext.useWsl
        ? undefined
        : buildNpmCliFallback([
            '--silent',
            'install',
            '--prefix',
            installBaseDir
          ])
      execInstallCommand(rootCommand, {
        cwd: wslContext.useWsl ? undefined : installBaseDir,
        fallbackNpmCommand: rootFallbackCommand
      })
      console.log(messages.optionalToolingReady(integration))
    }
    return true
  } catch (error) {
    console.error('[extension.js][optional-deps] debug', {
      platform: process.platform,
      execPath: process.execPath,
      cwd: process.cwd(),
      path: process.env.PATH || process.env.Path,
      comspec: process.env.ComSpec,
      systemRoot: process.env.SystemRoot,
      npm_execpath: process.env.npm_execpath,
      npm_config_user_agent: process.env.npm_config_user_agent,
      npm_config_prefix: process.env.npm_config_prefix,
      npm_config_cache: process.env.npm_config_cache,
      npm_config_userconfig: process.env.npm_config_userconfig,
      installBaseDir,
      wslContext,
      pm
    })
    const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
    if (isMissingManagerError(error)) {
      console.error(messages.optionalInstallManagerMissing(integration))
    } else {
      console.error(
        messages.optionalInstallFailed(integration, error, isAuthor)
      )
    }
    return false
  }
}

export function hasDependency(projectPath: string, dependency: string) {
  const findNearestPackageJsonDirectory = (
    startPath: string
  ): string | undefined => {
    let currentDirectory = startPath
    const maxDepth = 4

    for (let i = 0; i < maxDepth; i++) {
      const candidate = path.join(currentDirectory, 'package.json')

      if (fs.existsSync(candidate)) return currentDirectory

      const parentDirectory = path.dirname(currentDirectory)

      if (parentDirectory === currentDirectory) break
      currentDirectory = parentDirectory
    }
    return undefined
  }

  const packageJsonDirectory = findNearestPackageJsonDirectory(projectPath)
  if (!packageJsonDirectory) return false

  const packageJsonPath = path.join(packageJsonDirectory, 'package.json')
  if (!fs.existsSync(packageJsonPath)) return false

  const packageJson = parseJsonSafe(fs.readFileSync(packageJsonPath, 'utf8'))
  const dependencies = packageJson.dependencies || {}
  const devDependencies = packageJson.devDependencies || {}

  return !!dependencies[dependency] || !!devDependencies[dependency]
}
