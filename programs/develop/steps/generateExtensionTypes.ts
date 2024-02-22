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
// This file is auto-generated and should not be excluded.
// If you need extra types, consider creating a new *.d.ts and
// referencing it in the "include" array in your tsconfig.json file.
// See https://www.typescriptlang.org/tsconfig#include for info.
/// <reference types="${typePath}" />

`

  try {
    // Check if the file exists
    await fs.access(extensionEnvFile)
    console.log('🔵 - extension-env.d.ts already exists.')
  } catch (err) {
    // File does not exist, continue to write it
    console.log(
      '🔷 - TypeScript install detected. Writing extension type definitions...'
    )
    try {
      await fs.writeFile(extensionEnvFile, fileContent)
    } catch (writeErr) {
      console.log(
        '🔴 - Failed to write the extension type definition.',
        writeErr
      )
    }
  }
}
