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
    // Ensure the project path exists
    await fs.mkdir(projectPath, {recursive: true})

    let templatePath = ''

    if (process.env.EXTENSION_ENV === 'development') {
      console.log(messages.installingFromTemplate(projectName, template))

      templatePath = path.join(projectPath, templateName)

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

    if (projectName !== templateName) {
      await fs.rename(templatePath, path.join(installationPath, projectName))
    } else {
      // Here we are in a templatePath/templateName situation.
      // We first rename the top-level path to projectName-temp
      // and then rename the templateName folder to projectName.

      // e.g. new-react/new-react is at this moment new-react-temp/new-react
      await fs.rename(
        templatePath,
        path.join(installationPath, projectName + '-temp')
      )

      // Copy the new-react-temp/new-react to new-react
      await fs.cp(
        path.join(installationPath, projectName + '-temp', templateName),
        path.join(installationPath, projectName),
        {recursive: true}
      )

      // Remove the new-react-temp folder
      await fs.rm(path.join(installationPath, projectName + '-temp'), {
        recursive: true
      })
    }
  } catch (error: any) {
    console.error(
      messages.installingFromTemplateError(projectName, templateName, error)
    )
    process.exit(1)
  }
}
