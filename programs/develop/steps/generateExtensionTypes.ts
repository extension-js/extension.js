// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs/promises'
import {bold, blue, yellow} from '@colors/colors/safe'

export default async function generateExtensionTypes(projectDir: string) {
  const extensionEnvFile = path.join(projectDir, 'extension-env.d.ts')

  const typePath =
    process.env.EXTENSION_ENV === 'development'
      ? '../../programs/develop/types'
      : `@extension-create/develop/dist/types`

  const fileContent = `\
// Required Extension types for TypeScript projects.
// This file is auto-generated and should not be excluded.
// If you need extra types, consider creating a new *.d.ts and
// referencing it in the "include" array in your tsconfig.json file.
// See https://www.typescriptlang.org/tsconfig#include for info.
/// <reference types="${typePath}/index.d.ts" />

// Polyfill types for browser.* APIs.
/// <reference types="${typePath}/polyfill.d.ts" />
`

  const manifest = require(path.join(projectDir, 'manifest.json'))

  try {
    // Check if the file exists
    await fs.access(extensionEnvFile)
    console.log(
      bold(
        `🧩 Extension ${blue('►►►')} ${manifest.name} (v${manifest.version}) `
      ) + `${yellow('extension-env.d.ts')} already exists.`
    )
  } catch (err) {
    // File does not exist, continue to write it
    console.log(
      bold(
        `🧩 Extension ${blue('►►►')} ${manifest.name} (v${manifest.version}) `
      ) +
        `${blue(
          bold('TypeScript')
        )} install detected. Writing extension type definitions...`
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
