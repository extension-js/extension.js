//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {execFileSync} from 'child_process'
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

async function resolvePackageManager(): Promise<DetectedPackageManager> {
  const envPm = getPackageManagerFromEnv()
  if (envPm) return envPm
  return 'npm'
}

type InstallCommand = {
  command: string
  args: string[]
}

function resolveDevelopInstallRoot(): string | undefined {
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

function getOptionalInstallCommand(
  pm: DetectedPackageManager,
  dependencies: string[],
  installBaseDir: string
): InstallCommand {
  const pmName = pm

  if (pmName === 'yarn') {
    return {
      command: 'yarn',
      args: [
        '--silent',
        'add',
        ...dependencies,
        '--cwd',
        installBaseDir,
        '--optional'
      ]
    }
  }

  if (pmName === 'npm' || isFromNpx()) {
    return {
      command: 'npm',
      args: [
        '--silent',
        'install',
        ...dependencies,
        '--prefix',
        installBaseDir,
        '--save-optional'
      ]
    }
  }

  if (isFromPnpx()) {
    return {
      command: 'pnpm',
      args: [
        '--silent',
        'add',
        ...dependencies,
        '--prefix',
        installBaseDir,
        '--save-optional'
      ]
    }
  }

  const fallback = pmName || 'npm'
  return {
    command: fallback,
    args: [
      '--silent',
      'install',
      ...dependencies,
      '--cwd',
      installBaseDir,
      '--optional'
    ]
  }
}

function getRootInstallCommand(pm: DetectedPackageManager): InstallCommand {
  const pmName = pm
  if (pmName === 'yarn') return {command: 'yarn', args: ['install', '--silent']}
  if (pmName === 'npm' || isFromNpx())
    return {command: 'npm', args: ['install', '--silent']}
  if (isFromPnpx()) return {command: 'pnpm', args: ['install', '--silent']}
  return {command: pmName || 'npm', args: ['install', '--silent']}
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
  } catch (error) {
    const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
    console.error(messages.optionalInstallFailed(integration, error, isAuthor))
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
  } catch (error) {
    const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
    console.error(messages.optionalInstallFailed(integration, error, isAuthor))
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
