// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {findExtensionDevelopRoot} from './develop-context'
import * as messages from './messages'
import {isDebug} from './messaging'
import {
  buildInstallCommand,
  execInstallCommand,
  findPnpmWorkspaceMember,
  installScriptSuppression,
  projectInstallTarget,
  resolveNpmPackageManager,
  resolvePackageManager
} from './package-manager'
import {type AbsolutePath, needsInstall} from './paths'

export async function ensureUserProjectDependencies(
  packageJsonDir: AbsolutePath
) {
  const member = findPnpmWorkspaceMember(packageJsonDir)
  if (!needsInstall(packageJsonDir, member?.root)) return

  // A member's lockfile lives at its workspace root, so the manager is read there.
  const pm = resolvePackageManager({cwd: member?.root ?? packageJsonDir})
  const suppression = installScriptSuppression(pm)
  const target = projectInstallTarget(pm, packageJsonDir, member)
  const cmd = buildInstallCommand(pm, [
    'install',
    ...suppression.args,
    ...target.args
  ])

  if (suppression.args.length || Object.keys(suppression.env).length) {
    console.warn(messages.projectInstallScriptsDisabled(pm.name))
  }

  if (target.cwd !== packageJsonDir) {
    console.warn(messages.projectInstallInWorkspaceRoot(target.cwd))
  }

  try {
    await execInstallCommand(cmd.command, cmd.args, {
      cwd: target.cwd,
      stdio: 'inherit',
      env: suppression.env
    })
  } catch (error) {
    // The resolved manager can fail through no fault of the project (e.g. a
    // `packageManager` pin too old for Node); one npm retry keeps the build alive.
    if (pm.name === 'npm') throw error
    // A Deno project's dependencies live in deno.json(c) `npm:` imports,
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
  const isAuthor = isDebug()
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
