//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import fs from 'fs/promises'
import goGitIt from 'go-git-it'
import * as messages from '../lib/messages'

export async function importExternalTemplate(
  projectPath: string,
  projectName: string,
  template: string
) {
  const installationPath = path.dirname(projectPath)
  const templateName = path.basename(template)
  const examplesUrl =
    'https://github.com/extension-js/extension.js/tree/main/examples'
  const templateUrl = `${examplesUrl}/${template}`

  try {
    await fs.mkdir(projectPath, {recursive: true})

    if (process.env.EXTENSION_ENV === 'development') {
      await fs.copyFile(
        path.join(__dirname, '..', '..', '..', 'examples', templateName),
        path.join(installationPath, templateName)
      )
    } else {
      await goGitIt(
        templateUrl,
        installationPath,
        messages.installingFromTemplate(projectName, templateName)
      )
    }

    const templatePath = path.join(installationPath, templateName)

    await fs.rename(templatePath, projectPath)
  } catch (error: any) {
    console.error(
      messages.installingFromTemplateError(projectName, templateName, error)
    )
    process.exit(1)
  }
}
