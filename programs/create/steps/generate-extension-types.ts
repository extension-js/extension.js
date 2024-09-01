// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs/promises'
import * as messages from '../lib/messages'

export async function generateExtensionTypes(
  projectPath: string,
  projectName: string
) {
  const extensionEnvFile = path.join(projectPath, 'extension-env.d.ts')
  const typePath =
    process.env.EXTENSION_ENV === 'development'
      ? path.resolve(process.cwd(), 'programs/cli/types')
      : 'extension/dist/types'

  const fileContent = `\
// Required Extension.js types for TypeScript projects.
// This file is auto-generated and should not be excluded.
// If you need additional types, consider creating a new *.d.ts file and
// referencing it in the "include" array of your tsconfig.json file.
// See https://www.typescriptlang.org/tsconfig#include for more information.
/// <reference types="${typePath}/index.d.ts" />

// Polyfill types for browser.* APIs.
/// <reference types="${typePath}/polyfill.d.ts" />
`

  try {
    await fs.mkdir(projectPath, {recursive: true})

    console.log(messages.writingTypeDefinitions(projectName))

    await fs.writeFile(extensionEnvFile, fileContent)
  } catch (error: any) {
    console.error(messages.writingTypeDefinitionsError(error))

    process.exit(1)
  }
}
