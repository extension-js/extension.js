// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as path from 'path'
import * as fs from 'fs/promises'
import * as messages from './messages'

export async function generateExtensionTypes(projectPath: string) {
  const extensionEnvFile = path.join(projectPath, 'extension-env.d.ts')
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
    // Check if the file exists
    await fs.access(extensionEnvFile)

    // Read the file content
    const existingContent = await fs.readFile(extensionEnvFile, 'utf8')

    // Check if the file contains the "develop/dist/types" string
    if (existingContent.includes('develop/dist/types')) {
      // Rewrite previous path for versions < 2.0.0. See #162
      await fs.writeFile(extensionEnvFile, fileContent)
    }

    // Always rewrite the path to ensure it uses the correct published package path
    await fs.writeFile(extensionEnvFile, fileContent)
  } catch (err) {
    // File does not exist, continue to write it
    const manifest = require(path.join(projectPath, 'manifest.json'))
    console.log(messages.writingTypeDefinitions(manifest))
    try {
      await fs.writeFile(extensionEnvFile, fileContent)
    } catch (writeErr) {
      console.log(messages.writingTypeDefinitionsError(writeErr))
    }
  }
}
