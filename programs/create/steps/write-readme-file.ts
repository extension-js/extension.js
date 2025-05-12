//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import * as path from 'path'
import {fileURLToPath} from 'url'
import fs from 'fs/promises'
import * as messages from '../lib/messages'
import * as utils from '../lib/utils'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export async function writeReadmeFile(
  projectPath: string,
  projectName: string
) {
  const initTemplateReadme = await fs.readFile(
    path.join(__dirname, 'template', 'README.md'),
    'utf-8'
  )

  const installCommand = await utils.getInstallCommand()
  const manifestJsonPath = path.join(projectPath, 'manifest.json')
  const manifestJson = JSON.parse(await fs.readFile(manifestJsonPath, 'utf-8'))

  const readmeFileEdited = initTemplateReadme
    .replaceAll('[projectName]', projectName)
    .replaceAll('[templateDescription]', manifestJson.description)
    .replaceAll('[runCommand]', installCommand)

  try {
    console.log(messages.writingReadmeMetaData())

    // Ensure path to project exists
    await fs.mkdir(projectPath, {recursive: true})
    await fs.writeFile(path.join(projectPath, 'README.md'), readmeFileEdited)
  } catch (error: any) {
    console.error(messages.writingReadmeMetaDataEError(projectName, error))

    process.exit(1)
  }
}
