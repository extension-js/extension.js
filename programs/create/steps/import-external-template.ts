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
import * as utils from '../lib/utils'

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

      const localTemplatePath = path.join(
        __dirname,
        '..',
        '..',
        '..',
        'examples',
        templateName
      )

      await utils.copyDirectory(localTemplatePath, templatePath)
    } else {
      await goGitIt(
        templateUrl,
        installationPath,
        messages.installingFromTemplate(projectName, templateName)
      )

      templatePath = path.join(installationPath, templateName)
    }

    if (projectName !== templateName) {
      // Instead of renaming, copy the contents and then remove the original folder
      const destPath = path.join(installationPath, projectName)

      // Copy the contents from templatePath to destPath
      await fs.mkdir(destPath, {recursive: true})
      const files = await fs.readdir(templatePath)
      for (const file of files) {
        await fs.rename(
          path.join(templatePath, file),
          path.join(destPath, file)
        )
      }

      // Remove the original templatePath folder
      await fs.rm(templatePath, {recursive: true, force: true})
    } else {
      // Handle the templatePath/templateName situation
      const tempPath = path.join(installationPath, projectName + '-temp')
      await fs.rename(templatePath, tempPath)

      // Move the contents of the tempPath/templateName to projectName
      const srcPath = path.join(tempPath, templateName)
      const destPath = path.join(installationPath, projectName)
      await fs.mkdir(destPath, {recursive: true})
      const files = await fs.readdir(srcPath)
      for (const file of files) {
        await fs.rename(path.join(srcPath, file), path.join(destPath, file))
      }

      // Remove the temporary directory
      await fs.rm(tempPath, {recursive: true, force: true})
    }
  } catch (error: any) {
    console.error(
      messages.installingFromTemplateError(projectName, templateName, error)
    )
    process.exit(1)
  }
}
