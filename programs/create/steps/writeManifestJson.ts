//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import fs from 'fs/promises'
import {bold, red, yellow} from '@colors/colors/safe'

export default async function writeManifestJson(
  projectPath: string,
  projectName: string,
  template: string
) {
  const manifestJsonPath = path.join(projectPath, 'manifest.json')

  const manifestJsonContent = await fs.readFile(manifestJsonPath)
  const manifestJson = JSON.parse(manifestJsonContent.toString())

  const manifestMetadata = {
    ...manifestJson,
    name: path.basename(projectPath)
  }

  try {
    console.log(`📜 - Writing ${yellow(`manifest.json`)} metadata...`)
    await fs.writeFile(
      path.join(projectPath, 'manifest.json'),
      JSON.stringify(manifestMetadata, null, 2)
    )
  } catch (error: any) {
    console.error(
      `🧩 ${bold(`Extension.js`)} ${red(`✖︎✖︎✖︎`)} Can't write ${yellow(
        `manifest.json`
      )} for ${bold(projectName)}. ${error}`
    )

    process.exit(1)
  }
}
