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
  const override = getPackageManagerOverride()
  if (override) return override

  const envPm = getPackageManagerFromEnv()
  const execPath = process.env.npm_execpath || process.env.NPM_EXEC_PATH
  if (envPm) return {name: envPm, execPath}

  const candidates: DetectedPackageManager[] = ['pnpm', 'yarn', 'npm', 'bun']
  for (const candidate of candidates) {
    if (commandExists(candidate)) return {name: candidate}
  }

  if (execPath) {
    const inferred = execPath.includes('pnpm')
      ? 'pnpm'
      : execPath.includes('yarn')
        ? 'yarn'
        : execPath.includes('npm')
          ? 'npm'
          : 'npm'
    return {name: inferred, execPath}
  }

  const bundledNpmCli = resolveBundledNpmCliPath()
  if (bundledNpmCli) {
    return {name: 'npm', execPath: bundledNpmCli}
  }

  if (commandExists('corepack')) {
    const fallbackChain: DetectedPackageManager[] = ['pnpm', 'yarn', 'npm']
    return {
      name: fallbackChain[0],
      runnerCommand: 'corepack',
      runnerArgs: [fallbackChain[0]]
    }
  }

  return {name: 'npm'}
}

type InstallCommand = {
  command: string
  args: string[]
}

function commandExists(command: string) {
  try {
    const result = spawnSync(command, ['-v'], {stdio: 'ignore'})
    return result.status === 0
  } catch {
    return false
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
        command: 'npm',
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
  return maybeWrapExecPath(
    {
      command: fallback,
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

function getRootInstallCommand(pm: PackageManagerResolution): InstallCommand {
  const pmName = pm.name
  if (pmName === 'yarn') {
    return maybeWrapExecPath(
      {command: 'yarn', args: ['install', '--silent']},
      pmName,
      pm.execPath,
      pm.runnerCommand,
      pm.runnerArgs
    )
  }

  if (pmName === 'npm' || isFromNpx()) {
    return maybeWrapExecPath(
      {command: 'npm', args: ['install', '--silent']},
      pmName,
      pm.execPath,
      pm.runnerCommand,
      pm.runnerArgs
    )
  }

  if (pmName === 'pnpm' || isFromPnpx()) {
    return maybeWrapExecPath(
      {command: 'pnpm', args: ['install', '--silent']},
      pmName,
      pm.execPath,
      pm.runnerCommand,
      pm.runnerArgs
    )
  }

  if (pmName === 'bun') {
    return maybeWrapExecPath(
      {command: 'bun', args: ['install']},
      pmName,
      pm.execPath,
      pm.runnerCommand,
      pm.runnerArgs
    )
  }

  return maybeWrapExecPath(
    {command: pmName || 'npm', args: ['install', '--silent']},
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

  try {
    const pm = await resolvePackageManager()
    const installBaseDir = resolveDevelopInstallRoot()
    if (!installBaseDir) {
      throw new Error(messages.optionalInstallRootMissing(integration))
    }
    const installCommand = getOptionalInstallCommand(
      pm,
      dependencies,
      installBaseDir
    )

    const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
    console.log(
      messages.optionalToolingSetup([integration], integration, isAuthor)
    )

    execFileSync(installCommand.command, installCommand.args, {
      stdio: 'inherit',
      cwd: installBaseDir
    })
    await new Promise((resolve) => setTimeout(resolve, 500))

    if (isAuthor) {
      console.log(messages.optionalToolingRootInstall(integration))
      const rootInstall = getRootInstallCommand(pm)
      execFileSync(rootInstall.command, rootInstall.args, {
        stdio: 'ignore',
        cwd: installBaseDir
      })
      console.log(messages.optionalToolingReady(integration))
    }
    return true
  } catch (error) {
    const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
    const err = error as NodeJS.ErrnoException
    const isMissingManager =
      err?.code === 'ENOENT' ||
      String(err?.message || '').includes('ENOENT') ||
      String(err?.message || '').includes('not found')
    if (isMissingManager) {
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

  try {
    const pm = await resolvePackageManager()
    const installBaseDir = resolveDevelopInstallRoot()
    if (!installBaseDir) {
      throw new Error(messages.optionalInstallRootMissing(integration))
    }
    const installCommand = getOptionalInstallCommand(
      pm,
      dependencies,
      installBaseDir
    )

    const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
    console.log(
      messages.optionalToolingSetup(integrations, integration, isAuthor)
    )

    execFileSync(installCommand.command, installCommand.args, {
      stdio: 'inherit',
      cwd: installBaseDir
    })
    await new Promise((resolve) => setTimeout(resolve, 500))

    if (isAuthor) {
      console.log(messages.optionalToolingRootInstall(integration))
      const rootInstall = getRootInstallCommand(pm)
      execFileSync(rootInstall.command, rootInstall.args, {
        stdio: 'ignore',
        cwd: installBaseDir
      })
      console.log(messages.optionalToolingReady(integration))
    }
    return true
  } catch (error) {
    const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
    const err = error as NodeJS.ErrnoException
    const isMissingManager =
      err?.code === 'ENOENT' ||
      String(err?.message || '').includes('ENOENT') ||
      String(err?.message || '').includes('not found')
    if (isMissingManager) {
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
