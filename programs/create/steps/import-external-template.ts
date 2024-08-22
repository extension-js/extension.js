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

    let templatePath = ''

    if (process.env.EXTENSION_ENV === 'development') {
      console.log(messages.installingFromTemplate(projectName, template))

      templatePath = path.join(installationPath, templateName)

      await fs.cp(
        path.join(__dirname, '..', '..', '..', 'examples', templateName),
        templatePath,
        {recursive: true}
      )
    } else {
      await goGitIt(
        templateUrl,
        installationPath,
        messages.installingFromTemplate(projectName, templateName)
      )

      templatePath = path.join(installationPath, templateName)
    }

    // Copy the contents of the template to the desired project path
    await fs.cp(templatePath, projectPath, {recursive: true})

    // Remove the original template directory
    await fs.rm(templatePath, {recursive: true, force: true})
  } catch (error: any) {
    console.error(
      messages.installingFromTemplateError(projectName, templateName, error)
    )
    process.exit(1)
  }
}
