// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {ensureDependencies} from './ensure-dependencies'
import {findExtensionDevelopRoot} from './check-build-dependencies'
import * as messages from './messages'
import {
  buildInstallCommand,
  execInstallCommand,
  resolvePackageManager
} from './package-manager'
import {getDirs} from './paths'
import {
  preflightOptionalDependencies,
  shouldRunOptionalPreflight
} from './preflight-optional-deps'
import type {ProjectStructure} from './project'
import type {DevOptions} from '../webpack-types'

export async function ensureProjectReady(
  projectStructure: ProjectStructure,
  mode: DevOptions['mode'],
  opts?: {
    installUserDeps?: boolean
    installBuildDeps?: boolean
    installOptionalDeps?: boolean
    backgroundOptionalDeps?: boolean
    exitOnInstall?: boolean
    showRunAgainMessage?: boolean
  }
): Promise<{
  installed: boolean
  installedBuild: boolean
  installedUser: boolean
}> {
  const {packageJsonDir} = getDirs(projectStructure)
  const result = await ensureDependencies(packageJsonDir, {
    installUserDeps: opts?.installUserDeps,
    installBuildDeps: opts?.installBuildDeps,
    exitOnInstall: opts?.exitOnInstall,
    showRunAgainMessage: opts?.showRunAgainMessage
  })
  if (opts?.installBuildDeps !== false) {
    await ensureDevelopArtifacts()
  }

  const shouldInstallOptional = opts?.installOptionalDeps !== false
  if (shouldInstallOptional && shouldRunOptionalPreflight(projectStructure)) {
    const runOptional = () =>
      preflightOptionalDependencies(projectStructure, mode, {
        exitOnInstall: opts?.exitOnInstall,
        showRunAgainMessage: opts?.showRunAgainMessage
      })

    if (opts?.backgroundOptionalDeps) {
      runOptional().catch((error) => {
        console.error(error)
      })
    } else {
      await runOptional()
    }
  }

  return result
}

async function ensureDevelopArtifacts() {
  const developRoot = findExtensionDevelopRoot()
  if (!developRoot) return

  const requiredFiles = [
    path.join(developRoot, 'dist', 'ensure-hmr-for-scripts.js'),
    path.join(developRoot, 'dist', 'minimum-script-file.js')
  ]
  const missing = requiredFiles.filter((file) => !fs.existsSync(file))
  if (missing.length === 0) return

  const pm = resolvePackageManager({cwd: developRoot})
  const command = buildInstallCommand(pm, ['run', 'compile'])
  const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
  const stdio = isAuthor ? 'inherit' : 'ignore'

  if (isAuthor) {
    console.warn(
      messages.authorInstallNotice(
        'extension-develop build artifacts (dist missing)'
      )
    )
  }

  await execInstallCommand(command.command, command.args, {
    cwd: developRoot,
    stdio
  })
}
