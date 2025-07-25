//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import * as path from 'path'
import {fileURLToPath} from 'url'
import * as messages from '../lib/messages'
import * as utils from '../lib/utils'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export async function importLocalTemplate(
  projectPath: string,
  projectName: string,
  template: string
) {
  const localTemplatePath = path.resolve(__dirname, 'template')

  try {
    console.log(messages.installingFromTemplate(projectName, template))
    await utils.copyDirectoryWithSymlinks(localTemplatePath, projectPath)
  } catch (error: any) {
    console.error(
      messages.installingFromTemplateError(projectName, template, error)
    )
    throw error
  }
}
