// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as messages from './messages'
import {parseJsonSafe} from './parse-json-safe'

export async function generateExtensionTypes(
  manifestDir: string,
  packageJsonDir: string
) {
  const extensionEnvFile = path.join(packageJsonDir, 'extension-env.d.ts')
  // Always use the published package path to ensure compatibility in monorepos
  const typePath = 'extension'
  const fileContent = `\
// Required Extension.js types for TypeScript projects.
// This file is auto-generated and should not be excluded.
// If you need additional types, consider creating a new *.d.ts file and
// referencing it in the "include" array of your tsconfig.json file.
// See https://www.typescriptlang.org/tsconfig#include for more information.
/// <reference types="${typePath}/types" />

// Polyfill types for browser.* APIs
/// <reference types="${typePath}/types/polyfill" />
`

  try {
    await fs.access(extensionEnvFile)

    const existingContent = await fs.readFile(extensionEnvFile, 'utf8')

    if (existingContent.includes('develop/dist/types')) {
      // Rewrite previous path for versions < 2.0.0. See #162
      await fs.writeFile(extensionEnvFile, fileContent)
    }

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
