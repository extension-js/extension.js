// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import programPackageJson from '../package.json'
import * as messages from './messages'
import {readProjectDependencies} from './project-manifest'

function isReferencedAsModuleSpecifier(
  configSource: string,
  dep: string
): boolean {
  const escaped = dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Quote, exact package name, optional `/subpath`, matching quote.
  const specifierRe = new RegExp(`['"\`]${escaped}(?:/[^'"\`]*)?['"\`]`)
  return specifierRe.test(configSource)
}

// Ensures the user's project does not declare packages that are
// managed by Extension.js itself. Managed packages live in the
// develop program's package.json (dependencies/optionalDependencies).
// If a conflict is found, throw a helpful error so the current command
// aborts. Throwing (not process.exit) matters: this fires during config
// load, and the same code path serves programmatic hosts that embed
// extension-develop, a hard exit here kills the whole host process.
// `userManifestPath` is the project's manifest: package.json or deno.json(c),
// dependencies are read from whichever manifests its directory holds.
export function assertNoManagedDependencyConflicts(
  userManifestPath: string,
  projectPath: string
) {
  let duplicates: string[] = []

  try {
    const userDeps: string[] = Object.keys(
      readProjectDependencies(path.dirname(userManifestPath))
    )

    const managedDeps = new Set<string>([
      ...Object.keys(
        (programPackageJson as {dependencies?: Record<string, string>})
          .dependencies || {}
      ),
      ...Object.keys(
        (
          programPackageJson as {
            optionalDependencies?: Record<string, string>
          }
        ).optionalDependencies || {}
      )
    ])

    // Some internal toolchain dependencies (e.g. dev-server peers) can also be
    // legitimately installed by user projects. Do not treat these as "managed"
    // to avoid false-positive conflict errors.
    managedDeps.delete('webpack')

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

    duplicates = userDeps
      .filter((d) => managedDeps.has(d))
      .filter((d) => isReferencedAsModuleSpecifier(configSource, d))
      .sort()
  } catch (error) {
    // Be conservative: do not block if we cannot read user's package.json
    // but surface a minimal warning for visibility in development.
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      // eslint-disable-next-line no-console
      console.warn(error)
    }
  }

  if (duplicates.length > 0) {
    throw new Error(
      messages.managedDependencyConflict(duplicates, userManifestPath)
    )
  }
}
