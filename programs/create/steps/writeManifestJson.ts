//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import fs from 'fs/promises'
import {red, brightYellow} from '@colors/colors/safe'

export default async function writeManifestJson(
  projectPath: string,
  projectName: string
) {
  const manifestJsonPath = path.join(projectPath, 'manifest.json')

  const manifestJsonContent = await fs.readFile(manifestJsonPath)
  const manifestJson = JSON.parse(manifestJsonContent.toString())

  const manifestMetadata = {
    ...manifestJson,
    name: path.basename(projectPath)
  }

  try {
    console.log(`📜 - Writing ${brightYellow(`manifest.json`)} metadata...`)
    await fs.writeFile(
      path.join(projectPath, 'manifest.json'),
      JSON.stringify(manifestMetadata, null, 2)
    )
  } catch (error: any) {
    console.error(
      `🧩 ${`Extension.js`} ${red(`✖︎✖︎✖︎`)} Can't write ${brightYellow(
        `manifest.json`
      )} for ${projectName}. ${error}`
    )

    process.exit(1)
  }
}
