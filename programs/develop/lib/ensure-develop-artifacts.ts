// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {findExtensionDevelopRoot} from './develop-context'
import * as messages from './messages'
import {
  buildInstallCommand,
  execInstallCommand,
  installScriptSuppression,
  projectInstallArgs,
  resolveNpmPackageManager,
  resolvePackageManager
} from './package-manager'
import {type AbsolutePath, needsInstall} from './paths'

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
  const suppression = installScriptSuppression(pm)
  const cmd = buildInstallCommand(pm, [
    'install',
    ...suppression.args,
    ...projectInstallArgs(pm, packageJsonDir)
  ])

  if (suppression.args.length || Object.keys(suppression.env).length) {
    console.warn(messages.projectInstallScriptsDisabled(pm.name))
  }

  try {
    await execInstallCommand(cmd.command, cmd.args, {
      cwd: packageJsonDir,
      stdio: 'inherit',
      env: suppression.env
    })
  } catch (error) {
    // The resolved manager can fail through no fault of the project's own
    // dependency graph — e.g. corepack honoring a `packageManager` pin to a
    // pnpm too old for the running Node (G28). npm ships with Node itself,
    // so one retry with it keeps the build alive; `--no-package-lock` avoids
    // dropping a lockfile the project's real manager never asked for.
    if (pm.name === 'npm') throw error
    // A Deno project's dependencies live in deno.json(c) `npm:` imports —
    // npm cannot install those (and may have no package.json to read at all).
    if (pm.name === 'deno') throw error
    console.warn(messages.projectInstallFallbackToNpm(pm.name))

    const npmPm = resolveNpmPackageManager()
    const npmSuppression = installScriptSuppression(npmPm)
    const npmCmd = buildInstallCommand(npmPm, [
      'install',
      '--no-package-lock',
      ...npmSuppression.args
    ])
    await execInstallCommand(npmCmd.command, npmCmd.args, {
      cwd: packageJsonDir,
      stdio: 'inherit',
      env: npmSuppression.env
    })
  }
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
