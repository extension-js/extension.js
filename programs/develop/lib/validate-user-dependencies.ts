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
import {recordCodedWarning} from './coded-warnings'
import {findConfigFile} from './config-loader'
import * as messages from './messages'
import {CODES, isDebug} from './messaging'
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

// The packages a second copy of can really break: the bundler and what plugs
// into it. A project's own dotenv or vue never meets the copy shipped here.
const BUILD_PACKAGE =
  /^(@rspack\/.+|.+-loader|.+-webpack-plugin|webpack-target-webextension)$/

// Warns when the config file loads its own copy of a build package
// Extension.js ships. The build goes on: an abort here used to stop
// projects that built fine, and a version clash shows up in the build itself.
export function assertNoManagedDependencyConflicts(
  userManifestPath: string,
  projectPath: string
) {
  const shipped: Record<string, string> =
    (programPackageJson as {dependencies?: Record<string, string>})
      .dependencies || {}
  let duplicates: string[] = []
  let configPath = ''

  try {
    const userDeps: string[] = Object.keys(
      readProjectDependencies(path.dirname(userManifestPath))
    )

    // Only enforce when the same package is referenced in the config file
    // the loader itself would pick up for this project.
    configPath = findConfigFile(projectPath) || ''
    if (!configPath) return

    const configSource = fs.readFileSync(configPath, 'utf-8')

    duplicates = userDeps
      .filter((d) => d in shipped && BUILD_PACKAGE.test(d))
      .filter((d) => isReferencedAsModuleSpecifier(configSource, d))
      .sort()
  } catch (error) {
    // Be conservative: do not block if we cannot read user's package.json
    // but surface a minimal warning for visibility in development.
    if (isDebug()) {
      // eslint-disable-next-line no-console
      console.warn(error)
    }

    return
  }

  if (duplicates.length === 0) return

  recordCodedWarning(
    CODES.E_MANAGED_DEP_CONFLICT,
    `${path.basename(configPath)} loads its own copy of ${duplicates
      .map((name) => `${name} (Extension.js ships ${shipped[name]})`)
      .join(', ')}.`
  )

  warnOnce(
    messages.managedDependencyCopyWarning(
      duplicates.map((name) => ({name, shipped: shipped[name]})),
      configPath
    )
  )
}

// build, dev and preview each run the guard, and one session can run two.
const warned = new Set<string>()

function warnOnce(message: string) {
  if (warned.has(message)) return

  warned.add(message)
  // eslint-disable-next-line no-console
  console.warn(message)
}
