//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import * as messages from '../lib/messages'
import * as utils from '../lib/utils'

export async function importLocalTemplate(
  projectPath: string,
  projectName: string,
  template: string
) {
  const localTemplatePath = path.resolve(__dirname, 'template')

  try {
    console.log(messages.installingFromTemplate(projectName, template))
    await utils.copyDirectory(localTemplatePath, projectPath)
  } catch (error: any) {
    console.error(
      messages.installingFromTemplateError(projectName, template, error)
    )
    process.exit(1)
  }
}
