//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import * as messages from './messages'
import colors from 'pintor'
import {findExtensionDevelopRoot} from '../../webpack-lib/check-build-dependencies'
import {
  buildInstallCommand,
  buildNpmCliFallback,
  execInstallCommand,
  resolvePackageManager,
  type PackageManagerResolution
} from '../../webpack-lib/package-manager'
import {shouldShowProgress, startProgressBar} from '../../webpack-lib/progress'

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

async function preferCorepackFallback(
  pm: PackageManagerResolution
): Promise<PackageManagerResolution> {
  if (pm.name !== 'npm' || pm.execPath || pm.runnerCommand) return pm

  const npmUserAgent = process.env.npm_config_user_agent || ''
  const npmExecPath =
    process.env.npm_execpath || process.env.NPM_EXEC_PATH || ''

  if (npmUserAgent.includes('npm') || npmExecPath) {
    return pm
  }

  try {
    const {spawnSync} = (await import('child_process')) as any
    const result = spawnSync('corepack', ['--version'], {
      stdio: 'ignore',
      windowsHide: true
    })

    if (result?.status === 0) {
      return {name: 'pnpm', runnerCommand: 'corepack', runnerArgs: ['pnpm']}
    }
  } catch {
    // ignore
  }

  return pm
}

function isMissingManagerError(error: unknown) {
  const err = error as NodeJS.ErrnoException
  return (
    err?.code === 'ENOENT' ||
    String(err?.message || '').includes('ENOENT') ||
    String(err?.message || '').includes('not found')
  )
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

async function execInstallWithFallback(
  command: InstallCommand,
  options: ExecInstallOptions
) {
  try {
    await execInstallCommand(command.command, command.args, {
      cwd: options.cwd,
      stdio: 'inherit'
    })
    return
  } catch (error) {
    if (options.fallbackNpmCommand && isMissingManagerError(error)) {
      await execInstallCommand(
        options.fallbackNpmCommand.command,
        options.fallbackNpmCommand.args,
        {
          cwd: options.cwd,
          stdio: 'inherit'
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

function getOptionalInstallCommand(
  pm: PackageManagerResolution,
  dependencies: string[],
  installBaseDir: string
): InstallCommand {
  const pmName = pm.name

  if (pmName === 'yarn') {
    return buildInstallCommand(pm, [
      '--silent',
      'add',
      ...dependencies,
      '--cwd',
      installBaseDir,
      '--optional'
    ])
  }

  if (pmName === 'npm') {
    return buildInstallCommand(pm, [
      '--silent',
      'install',
      ...dependencies,
      '--prefix',
      installBaseDir,
      '--save-optional'
    ])
  }

  if (pmName === 'pnpm') {
    return buildInstallCommand(pm, [
      'add',
      ...dependencies,
      '--dir',
      installBaseDir,
      '--save-optional',
      '--silent'
    ])
  }

  if (pmName === 'bun') {
    return buildInstallCommand(pm, [
      'add',
      ...dependencies,
      '--cwd',
      installBaseDir,
      '--optional'
    ])
  }

  return buildInstallCommand(pm, [
    '--silent',
    'install',
    ...dependencies,
    '--cwd',
    installBaseDir,
    '--optional'
  ])
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
    return buildInstallCommand(pm, ['install', '--silent', ...dirArgs])
  }

  if (pmName === 'npm') {
    return buildInstallCommand(pm, ['install', '--silent', ...dirArgs])
  }

  if (pmName === 'pnpm') {
    return buildInstallCommand(pm, ['install', '--silent', ...dirArgs])
  }

  if (pmName === 'bun') {
    return buildInstallCommand(pm, ['install', ...dirArgs])
  }

  return buildInstallCommand(pm, ['install', '--silent', ...dirArgs])
}

export async function installOptionalDependencies(
  integration: string,
  dependencies: string[],
  options?: {
    index?: number
    total?: number
  }
) {
  if (!dependencies.length) return

  let pm: PackageManagerResolution | undefined
  let wslContext: WslContext | undefined
  let installBaseDir: string | undefined

  try {
    installBaseDir = resolveDevelopInstallRoot()
    if (!installBaseDir) {
      throw new Error(messages.optionalInstallRootMissing(integration))
    }
    pm = resolvePackageManager({cwd: installBaseDir})
    wslContext = resolveWslContext(installBaseDir)
    if (!wslContext.useWsl) {
      pm = await preferCorepackFallback(pm)
    }
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
    const setupMessages = messages.optionalToolingSetup(
      [integration],
      integration,
      isAuthor
    )
    const setupMessage = setupMessages[0]
    const hasIndex = Boolean(options?.index && options?.total)
    const setupMessageWithIndex = hasIndex
      ? setupMessage.replace(
          '►►► ',
          `►►► [${options?.index}/${options?.total}] `
        )
      : setupMessage
    const progressEnabled = !isAuthor && shouldShowProgress()
    const progress = startProgressBar(setupMessageWithIndex, {
      enabled: progressEnabled,
      persistLabel: true
    })

    if (isAuthor) {
      console.warn(setupMessageWithIndex)
    } else if (!progressEnabled) {
      console.log(setupMessageWithIndex)
    }

    try {
      await execInstallWithFallback(execCommand, {
        cwd: wslContext.useWsl ? undefined : installBaseDir,
        fallbackNpmCommand
      })
    } finally {
      progress.stop()
    }

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
      await execInstallWithFallback(rootCommand, {
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
  plans: Array<{integration: string; dependencies: string[]}>
) {
  if (!plans.length) return

  const executablePlans = plans.filter((plan) => plan.dependencies.length > 0)
  if (executablePlans.length === 0) return
  const totalDeps = executablePlans.reduce(
    (sum, plan) => sum + plan.dependencies.length,
    0
  )
  console.log(
    `${colors.gray('►►►')} Found ${colors.yellow(
      String(totalDeps)
    )} specialized dependencies needing installation...`
  )

  for (const [index, plan] of executablePlans.entries()) {
    const didInstall = await installOptionalDependencies(
      plan.integration,
      plan.dependencies,
      {
        index: index + 1,
        total: executablePlans.length
      }
    )

    if (!didInstall) {
      return false
    }
  }

  return true
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
