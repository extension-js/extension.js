// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs/promises'
import {bold, red} from '@colors/colors/safe'

export default async function generateExtensionTypes(
  projectPath: string,
  projectName: string
) {
  const extensionEnvFile = path.join(projectPath, 'extension-env.d.ts')
  const typePath =
    process.env.EXTENSION_ENV === 'development'
      ? path.resolve(process.cwd(), 'programs/develop/types')
      : '@extension-create/develop/dist/types'

  const fileContent = `\
// Required Extension types for TypeScript projects.
// This file auto-generated and should not be excluded.
// If you need extra types, consider creating a new *.d.ts and
// referencing it in the "include" array in your tsconfig.json file.
// See https://www.typescriptlang.org/tsconfig#include for info.
/// <reference types="${typePath}/index.d.ts" />

// Polyfill types for browser.* APIs.
/// <reference types="${typePath}/polyfill.d.ts" />
`

  try {
    await fs.mkdir(projectPath, {recursive: true})

    console.log(`🔷 - Writing ${projectName} type definitions...`)

    await fs.writeFile(extensionEnvFile, fileContent)
  } catch (error: any) {
    console.error(
      `🧩 ${bold(`extension`)} ${red(
        `✖︎✖︎✖︎`
      )} Failed to write the extension type definition. ${error}`
    )

    process.exit(1)
  }
}
