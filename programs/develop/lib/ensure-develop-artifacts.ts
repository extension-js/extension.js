// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {findExtensionDevelopRoot} from './develop-context'
import * as messages from './messages'
import {needsInstall, type AbsolutePath} from './paths'
import {
  buildInstallCommand,
  execInstallCommand,
  resolvePackageManager
} from './package-manager'

/**
 * Install the user's project dependencies if node_modules is missing or stale.
 * This runs `npm install` (or pnpm/yarn/bun) in the project directory so that
 * user-declared dependencies (sass, vue, react, etc.) are available to the
 * bundler. Without this, `pnpm dlx extension build` in a clean directory would
 * fail to resolve project dependencies.
 */
export async function ensureUserProjectDependencies(
  packageJsonDir: AbsolutePath
) {
  if (!needsInstall(packageJsonDir)) return

  const pm = resolvePackageManager({cwd: packageJsonDir})
  const cmd = buildInstallCommand(pm, ['install'])
  await execInstallCommand(cmd.command, cmd.args, {
    cwd: packageJsonDir,
    stdio: 'inherit'
  })
}

export async function ensureDevelopArtifacts() {
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
