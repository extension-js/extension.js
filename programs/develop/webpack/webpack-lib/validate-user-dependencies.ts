// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import * as messages from './messages'
import programPackageJson from '../../package.json'

// Ensures the user's project does not declare packages that are
// managed by Extension.js itself. Managed packages live in the
// develop program's package.json (dependencies/optionalDependencies).
// If a conflict is found, print a helpful error and abort the current command.
export function assertNoManagedDependencyConflicts(
  userPackageJsonPath: string,
  projectPath: string
) {
  try {
    const raw = fs.readFileSync(userPackageJsonPath, 'utf-8')
    const userPackageJson = JSON.parse(raw) as Record<string, any>

    const userDeps: string[] = Array.from(
      new Set([
        ...Object.keys(userPackageJson.dependencies || {}),
        ...Object.keys(userPackageJson.devDependencies || {}),
        ...Object.keys(userPackageJson.optionalDependencies || {}),
        ...Object.keys(userPackageJson.peerDependencies || {})
      ])
    )

    const managedDeps = new Set<string>([
      ...Object.keys((programPackageJson as any).dependencies || {}),
      ...Object.keys((programPackageJson as any).optionalDependencies || {})
    ])

    // Only enforce when the same package is referenced in user's extension.config.(js|mjs)
    const userConfigJs = path.join(projectPath, 'extension.config.js')
    const userConfigMjs = path.join(projectPath, 'extension.config.mjs')

    const hasConfig =
      fs.existsSync(userConfigJs) || fs.existsSync(userConfigMjs)
    if (!hasConfig) return

    const configPath = fs.existsSync(userConfigJs)
      ? userConfigJs
      : userConfigMjs
    const configSource = fs.readFileSync(configPath, 'utf-8')

    const duplicates = userDeps
      .filter((d) => managedDeps.has(d))
      .filter((d) => configSource.includes(d))
      .sort()

    if (duplicates.length > 0) {
      // Print detailed error and abort.
      // We intentionally hard-exit to prevent version conflicts.
      console.error(
        messages.managedDependencyConflict(duplicates, userPackageJsonPath)
      )
      process.exit(1)
    }
  } catch (error) {
    // Be conservative: do not block if we cannot read user's package.json
    // but surface a minimal warning for visibility in development.
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      // eslint-disable-next-line no-console
      console.warn(error)
    }
  }
}
