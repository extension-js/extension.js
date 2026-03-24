import * as path from 'path'
import colors from 'pintor'
import * as messages from '../plugin-css/css-lib/messages'
import {resolveOptionalDependencySpecs} from '../webpack-lib/optional-dependencies'
import {
  buildInstallCommand,
  buildNpmCliFallback,
  execInstallCommand,
  resolvePackageManager,
  type PackageManagerResolution
} from '../webpack-lib/package-manager'
import {prepareOptionalInstallState} from './cache-state'
import {resolvePackageFromInstallRoot} from './install-root-packages'
import {resolveOptionalInstallRoot} from './runtime-context'

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
  allowFallbackOnFailure?: boolean
}

export type InstallOptionalDependenciesOptions = {
  index?: number
  total?: number
  forceRecreateInstallRoot?: boolean
}

function getMissingDependenciesAtInstallRoot(
  dependencies: string[],
  installBaseDir: string
) {
  return dependencies.filter((dependencyId) => {
    return !resolvePackageFromInstallRoot(dependencyId, installBaseDir)
  })
}

function parseWslUncPath(value: string): {distro: string; path: string} | null {
  const match = /^\\\\wsl(?:\.localhost)?\\([^\\]+)\\(.+)$/.exec(value)
  if (!match) return null
  const distro = match[1]
  const rel = match[2].replace(/\\/g, '/').replace(/^\/+/, '')
  return {distro, path: `/${rel}`}
}

function isWslMountPath(value: string): boolean {
  return /^\/mnt\/[a-z]\//i.test(value)
}

function resolveWslContext(installBaseDir: string): WslContext {
  if (process.platform !== 'win32') return {useWsl: false}
  const trimmed = String(installBaseDir || '').trim()
  if (!trimmed) return {useWsl: false}
  const unc = parseWslUncPath(trimmed)
  if (unc) return {useWsl: true, distro: unc.distro, installDir: unc.path}
  if (isWslMountPath(trimmed)) return {useWsl: true, installDir: trimmed}
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

function isMissingManagerError(error: unknown) {
  const err = error as NodeJS.ErrnoException
  return (
    err?.code === 'ENOENT' ||
    String(err?.message || '').includes('ENOENT') ||
    String(err?.message || '').includes('not found')
  )
}

function isInstallExitFailure(error: unknown) {
  return /Install failed with exit code \d+/.test(
    String((error as Error)?.message || error || '')
  )
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
    if (
      options.fallbackNpmCommand &&
      (isMissingManagerError(error) ||
        (options.allowFallbackOnFailure && isInstallExitFailure(error)))
    ) {
      await execInstallCommand(
        options.fallbackNpmCommand.command,
        options.fallbackNpmCommand.args,
        {cwd: options.cwd, stdio: 'inherit'}
      )
      return
    }
    throw error
  }
}

async function preferCorepackFallback(
  pm: PackageManagerResolution
): Promise<PackageManagerResolution> {
  if (pm.name !== 'npm' || pm.execPath || pm.runnerCommand) return pm

  const npmUserAgent = process.env.npm_config_user_agent || ''
  const npmExecPath =
    process.env.npm_execpath || process.env.NPM_EXEC_PATH || ''
  if (npmUserAgent.includes('npm') || npmExecPath) return pm

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

function getOptionalInstallCommand(
  pm: PackageManagerResolution,
  dependencies: string[],
  installBaseDir: string
): InstallCommand {
  const pmName = pm.name
  const dependencySpecs = resolveOptionalDependencySpecs(dependencies)

  if (pmName === 'yarn') {
    return buildInstallCommand(pm, [
      '--silent',
      'add',
      ...dependencySpecs,
      '--cwd',
      installBaseDir,
      '--optional'
    ])
  }
  if (pmName === 'npm') {
    return getRootInstallCommand(pm, installBaseDir)
  }
  if (pmName === 'pnpm') {
    return buildInstallCommand(pm, [
      'install',
      '--dir',
      installBaseDir,
      '--ignore-workspace',
      '--lockfile=false',
      '--silent'
    ])
  }
  if (pmName === 'bun') {
    return buildInstallCommand(pm, [
      'add',
      ...dependencySpecs,
      '--cwd',
      installBaseDir,
      '--optional'
    ])
  }
  return buildInstallCommand(pm, [
    '--silent',
    'install',
    ...dependencySpecs,
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
    return buildInstallCommand(pm, [
      'install',
      '--silent',
      ...dirArgs,
      '--ignore-workspace',
      '--lockfile=false'
    ])
  }
  if (pmName === 'bun') {
    return buildInstallCommand(pm, ['install', ...dirArgs])
  }
  return buildInstallCommand(pm, ['install', '--silent', ...dirArgs])
}

async function runInstallAttempt(input: {
  pm: PackageManagerResolution
  wslContext: WslContext
  installBaseDir: string
  dependencies: string[]
  isAuthor: boolean
  integration: string
}) {
  const installCommand = getOptionalInstallCommand(
    input.pm,
    input.dependencies,
    input.wslContext.installDir || input.installBaseDir
  )
  const execCommand = wrapCommandForWsl(installCommand, input.wslContext)
  const fallbackNpmCommand = input.wslContext.useWsl
    ? undefined
    : buildNpmCliFallback([
        '--silent',
        'install',
        ...resolveOptionalDependencySpecs(input.dependencies),
        '--prefix',
        input.installBaseDir,
        '--save-optional'
      ])
  await execInstallWithFallback(execCommand, {
    cwd: input.wslContext.useWsl ? undefined : input.installBaseDir,
    fallbackNpmCommand,
    allowFallbackOnFailure:
      !input.wslContext.useWsl &&
      input.pm.name !== 'npm' &&
      fallbackNpmCommand !== undefined
  })

  await new Promise((resolve) => setTimeout(resolve, 500))

  const needsRootRelink =
    input.pm.name !== 'npm' && (input.isAuthor || input.dependencies.length > 1)
  if (!needsRootRelink) return

  if (input.isAuthor) {
    console.log(messages.optionalToolingRootInstall(input.integration))
  }

  const rootInstall = getRootInstallCommand(
    input.pm,
    input.wslContext.useWsl ? input.wslContext.installDir : undefined
  )
  const rootCommand = wrapCommandForWsl(rootInstall, input.wslContext)
  const rootFallbackCommand = input.wslContext.useWsl
    ? undefined
    : buildNpmCliFallback([
        '--silent',
        'install',
        '--prefix',
        input.installBaseDir
      ])

  await execInstallWithFallback(rootCommand, {
    cwd: input.wslContext.useWsl ? undefined : input.installBaseDir,
    fallbackNpmCommand: rootFallbackCommand,
    allowFallbackOnFailure:
      !input.wslContext.useWsl &&
      input.pm.name !== 'npm' &&
      rootFallbackCommand !== undefined
  })

  if (input.isAuthor) {
    console.log(messages.optionalToolingReady(input.integration))
  }
}

export async function installOptionalDependencies(
  integration: string,
  dependencies: string[],
  options?: InstallOptionalDependenciesOptions
) {
  if (!dependencies.length) return

  let pm: PackageManagerResolution | undefined
  let wslContext: WslContext | undefined
  let installBaseDir: string | undefined

  try {
    installBaseDir = resolveOptionalInstallRoot()
    prepareOptionalInstallState({
      installBaseDir,
      dependencies,
      forceRecreateInstallRoot: options?.forceRecreateInstallRoot
    })

    pm = resolvePackageManager({cwd: installBaseDir})
    wslContext = resolveWslContext(installBaseDir)
    if (!wslContext.useWsl) {
      pm = await preferCorepackFallback(pm)
    }

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
    if (isAuthor) console.warn(setupMessageWithIndex)
    else console.log(setupMessageWithIndex)

    await runInstallAttempt({
      pm,
      wslContext,
      installBaseDir,
      dependencies,
      isAuthor,
      integration
    })

    let missingDependencies = getMissingDependenciesAtInstallRoot(
      dependencies,
      installBaseDir
    )

    if (missingDependencies.length > 0 && pm.name !== 'npm') {
      await runInstallAttempt({
        pm,
        wslContext,
        installBaseDir,
        dependencies: missingDependencies,
        isAuthor,
        integration
      })

      missingDependencies = getMissingDependenciesAtInstallRoot(
        dependencies,
        installBaseDir
      )
    }

    if (missingDependencies.length > 0) {
      prepareOptionalInstallState({
        installBaseDir,
        dependencies,
        forceRecreateInstallRoot: true
      })
      await runInstallAttempt({
        pm,
        wslContext,
        installBaseDir,
        dependencies,
        isAuthor,
        integration
      })

      missingDependencies = getMissingDependenciesAtInstallRoot(
        dependencies,
        installBaseDir
      )
    }

    if (missingDependencies.length > 0) {
      throw new Error(
        `[${integration}] Optional dependency install reported success but packages are missing: ${missingDependencies.join(', ')}`
      )
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
      pm,
      errorCode: (error as NodeJS.ErrnoException)?.code,
      errorMessage:
        error instanceof Error
          ? error.message
          : String(error || 'unknown error')
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
  console.log(
    `${colors.gray('►►►')} Found ${colors.yellow(
      String(plans.length)
    )} specialized integration${plans.length === 1 ? '' : 's'} needing installation...`
  )
  for (const [index, plan] of plans.entries()) {
    const didInstall = await installOptionalDependencies(
      plan.integration,
      plan.dependencies,
      {index: index + 1, total: plans.length}
    )
    if (!didInstall) return false
  }
  return true
}
