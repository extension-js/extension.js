// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {existsSync} from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {loadDefineTypes} from './config-loader'
import {
  EXTENSION_ENV_TYPES_PACKAGE,
  renderExtensionEnvTypes
} from './extension-env-template'
import * as messages from './messages'
import {parseJsonSafe} from './parse-json-safe'

// The same node_modules walk TypeScript takes for the reference the file
// emits: a project run through npx has no extension of its own to find.
export function resolvesExtensionPackage(packageJsonDir: string): boolean {
  let dir = path.resolve(packageJsonDir)

  while (true) {
    const packageJson = path.join(
      dir,
      'node_modules',
      EXTENSION_ENV_TYPES_PACKAGE,
      'package.json'
    )

    if (existsSync(packageJson)) return true

    const parent = path.dirname(dir)
    if (parent === dir) return false

    dir = parent
  }
}

export async function generateExtensionTypes(
  manifestDir: string,
  packageJsonDir: string
) {
  const extensionEnvFile = path.join(packageJsonDir, 'extension-env.d.ts')
  const fileContent = renderExtensionEnvTypes(
    undefined,
    await loadDefineTypes(packageJsonDir),
    {inlineAssetTypes: !resolvesExtensionPackage(packageJsonDir)}
  )

  try {
    await fs.access(extensionEnvFile)

    const existingContent = await fs.readFile(extensionEnvFile, 'utf8')
    if (existingContent === fileContent) return

    // The file is the project's own, often committed, so a rewrite that
    // changes it is said out loud the way the first write is.
    console.log(messages.updatingTypeDefinitions(extensionEnvFile))
    await fs.writeFile(extensionEnvFile, fileContent)
  } catch (err) {
    const manifestText = await fs.readFile(
      path.join(manifestDir, 'manifest.json'),
      'utf8'
    )

    const manifest = parseJsonSafe(manifestText)
    console.log(messages.writingTypeDefinitions(manifest))

    try {
      await fs.writeFile(extensionEnvFile, fileContent)
    } catch (writeErr) {
      console.log(messages.writingTypeDefinitionsError(writeErr))
    }
  }
}
