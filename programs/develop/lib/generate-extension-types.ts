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
import type {Manifest} from '../types'
import {recordCodedWarning} from './coded-warnings'
import {type ConfigEnvTarget, loadDefineTypes} from './config-loader'
import {
  EXTENSION_ENV_TYPES_PACKAGE,
  projectBringsOwnChromeTypes,
  renderExtensionEnvTypes
} from './extension-env-template'
import * as messages from './messages'
import {CODES, humanLine} from './messaging'
import {parseJsonSafe} from './parse-json-safe'
import {tsconfigCanIncludeFile} from './tsconfig-includes-file'
import {getUserTypeScriptConfigFile} from './user-tsconfig'

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

// A formatter may own the file (semicolons, quote style, spacing), and a
// copy that differs only that way declares the same types.
function declaresTheSame(existing: string, expected: string): boolean {
  const shape = (text: string) =>
    text.replace(/["'`]/g, "'").replace(/[;\s]+/g, '')

  return shape(existing) === shape(expected)
}

// A file the project's TypeScript program would never read types nothing,
// so one that is not there is only created where a tsconfig can pick it up.
function projectReadsTypesFile(manifestDir: string, file: string): boolean {
  const tsconfig = getUserTypeScriptConfigFile(manifestDir)

  return !tsconfig || tsconfigCanIncludeFile(tsconfig, file)
}

export async function generateExtensionTypes(
  manifestDir: string,
  packageJsonDir: string,
  envTarget: ConfigEnvTarget
) {
  const extensionEnvFile = path.join(packageJsonDir, 'extension-env.d.ts')
  const fileContent = renderExtensionEnvTypes(
    undefined,
    await loadDefineTypes(packageJsonDir, envTarget),
    {
      inlineAssetTypes: !resolvesExtensionPackage(packageJsonDir),
      ownChromeTypes: projectBringsOwnChromeTypes(packageJsonDir)
    }
  )

  if (
    !existsSync(extensionEnvFile) &&
    !projectReadsTypesFile(manifestDir, extensionEnvFile)
  ) {
    return
  }

  try {
    await fs.access(extensionEnvFile)

    const existingContent = await fs.readFile(extensionEnvFile, 'utf8')
    if (declaresTheSame(existingContent, fileContent)) return

    // The file is the project's own, often committed, so a rewrite that
    // changes it is said out loud the way the first write is.
    humanLine(messages.updatingTypeDefinitions(extensionEnvFile))
    await fs.writeFile(extensionEnvFile, fileContent)
  } catch (err) {
    const manifestText = await fs.readFile(
      path.join(manifestDir, 'manifest.json'),
      'utf8'
    )

    const manifest = parseJsonSafe<Manifest>(manifestText)
    humanLine(messages.writingTypeDefinitions(manifest))

    try {
      await fs.writeFile(extensionEnvFile, fileContent)
    } catch (writeErr) {
      recordCodedWarning(
        CODES.W_TYPES_EMIT,
        `Writing ${extensionEnvFile} failed: ${
          writeErr instanceof Error ? writeErr.message : String(writeErr)
        }`
      )

      humanLine(messages.writingTypeDefinitionsError(writeErr))
    }
  }
}
