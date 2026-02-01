// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as messages from './messages'
import {
  areBuildDependenciesInstalled,
  findExtensionDevelopRoot,
  getMissingBuildDependencies
} from './check-build-dependencies'
import {installOwnDependencies} from './install-own-dependencies'
import {installDependencies} from './install-dependencies'
import {asAbsolute, needsInstall} from './paths'

export async function ensureDependencies(
  projectPath?: string,
  opts?: {
    installUserDeps?: boolean
    installBuildDeps?: boolean
    exitOnInstall?: boolean
    showRunAgainMessage?: boolean
  }
): Promise<{
  installed: boolean
  installedBuild: boolean
  installedUser: boolean
}> {
  const packageRoot = findExtensionDevelopRoot()
  const shouldCheckBuildDeps = opts?.installBuildDeps !== false
  const missingBuild =
    shouldCheckBuildDeps &&
    packageRoot &&
    !areBuildDependenciesInstalled(packageRoot)
      ? getMissingBuildDependencies(packageRoot)
      : []

  const shouldCheckUserDeps = opts?.installUserDeps !== false
  const shouldInstallUserDeps =
    shouldCheckUserDeps &&
    !!projectPath &&
    needsInstall(asAbsolute(projectPath))

  const needsBuildInstall = missingBuild.length > 0
  const needsUserInstall = shouldInstallUserDeps

  if (!needsBuildInstall && !needsUserInstall) {
    return {installed: false, installedBuild: false, installedUser: false}
  }

  console.log(messages.installingRequiredDependencies())

  if (needsBuildInstall && packageRoot) {
    await installOwnDependencies(missingBuild, packageRoot)
  }

  if (needsUserInstall && projectPath) {
    await installDependencies(projectPath)
  }

  if (opts?.showRunAgainMessage !== false) {
    console.log(messages.dependenciesInstalledRunAgain())
  }

  if (opts?.exitOnInstall) {
    process.exit(0)
  }

  return {
    installed: true,
    installedBuild: needsBuildInstall,
    installedUser: needsUserInstall
  }
}
