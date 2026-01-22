// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {spawn} from 'cross-spawn'
import {loadBuildDependencies} from './check-build-dependencies'
import * as messages from './messages'
import {getInstallCommandForPath} from './package-manager'

/**
 * Get the install command based on lockfiles and package manager detection
 */
async function getInstallCommand(packageRoot: string): Promise<string> {
  return getInstallCommandForPath(packageRoot)
}

/**
 * Get install arguments for a specific package manager and dependencies
 */
function getInstallArgs(
  command: string,
  dependencies: string[],
  dependenciesMap: Record<string, string>
): string[] {
  // Format dependencies as "package@version"
  const depsWithVersions = dependencies.map(
    (dep) => `${dep}@${dependenciesMap[dep]}`
  )

  if (command === 'pnpm') {
    return ['add', '--save', ...depsWithVersions]
  } else if (command === 'yarn') {
    return ['add', ...depsWithVersions]
  } else {
    // npm
    return ['install', '--save', ...depsWithVersions]
  }
}

/**
 * Install missing dependencies into extension-develop's node_modules
 */
export async function installOwnDependencies(
  dependencies: string[],
  packageRoot: string
): Promise<void> {
  if (dependencies.length === 0) {
    return
  }

  if (!packageRoot) {
    throw new Error('Package root is required for dependency installation')
  }

  const dependenciesMap = loadBuildDependencies()

  // Verify all requested dependencies are in the metadata
  const missingFromMetadata = dependencies.filter(
    (dep) => !(dep in dependenciesMap)
  )
  if (missingFromMetadata.length > 0) {
    throw new Error(
      `Dependencies not found in build-dependencies.json: ${missingFromMetadata.join(', ')}`
    )
  }

  const originalDirectory = process.cwd()

  try {
    // Change to package root before detecting package manager
    process.chdir(packageRoot)

    const command = await getInstallCommand(packageRoot)
    const installArgs = getInstallArgs(command, dependencies, dependenciesMap)

    const stdio =
      process.env.EXTENSION_AUTHOR_MODE === 'true' ? 'inherit' : 'ignore'

    console.log(messages.installingBuildDependencies(dependencies))

    const child = spawn(command, installArgs, {stdio})

    await new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(
              messages.buildDependenciesInstallFailed(
                command,
                installArgs,
                code
              )
            )
          )
        } else {
          resolve()
        }
      })

      child.on('error', (error) => {
        reject(error)
      })
    })
  } catch (error: any) {
    console.error(messages.buildDependenciesInstallError(error))
    console.error(
      messages.buildDependenciesManualInstall(dependencies, dependenciesMap)
    )
    process.exit(1)
  } finally {
    // Ensure we revert to the original directory even if an error occurs
    process.chdir(originalDirectory)
  }
}
