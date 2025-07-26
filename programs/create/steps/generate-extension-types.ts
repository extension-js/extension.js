// ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import * as path from 'path'
import * as fs from 'fs/promises'
import * as messages from '../lib/messages'

export async function generateExtensionTypes(
  projectPath: string,
  projectName: string
) {
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
    await fs.mkdir(projectPath, {recursive: true})

    console.log(messages.writingTypeDefinitions(projectName))

    await fs.writeFile(extensionEnvFile, fileContent)
  } catch (error: any) {
    console.error(messages.writingTypeDefinitionsError(error))
    throw error
  }
}
