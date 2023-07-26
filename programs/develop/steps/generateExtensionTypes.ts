// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs/promises'

export default async function generateExtensionTypes(projectDir: string) {
  const extensionEnvFile = path.join(projectDir, 'extension-env.d.ts')

  const typePath =
    process.env.EXTENSION_ENV === 'development'
      ? '../../programs/develop/types'
      : 'extension-create/develop/types'

  const fileContent = `\
// Required extension-create types for TypeScript projects.
// This file auto-generated and should not be excluded.
// If you need extra types, consider creating a new *.d.ts and
// referencing it in the "include" array in your tsconfig.json file.
// See https://www.typescriptlang.org/tsconfig#include for info.
/// <reference types="${typePath}" />

`

  try {
    // If there is a extension-env.d.ts file already, return early.
    if ((await fs.stat(extensionEnvFile)).isFile()) {
      return
    }

    console.log(
      '🔷 - TypeScript install detected. Writing extension type definitions...'
    )
    await fs.writeFile(extensionEnvFile, fileContent)
  } catch (err) {
    console.log('🔴 - Failed to write the extension type definition.')
  }
}
