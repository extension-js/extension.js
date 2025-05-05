//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import {fileURLToPath} from 'url'
import fs from 'fs/promises'
import goGitIt from 'go-git-it'
import * as messages from '../lib/messages'
import * as utils from '../lib/utils'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

      await utils.copyDirectoryWithSymlinks(localTemplatePath, templatePath)
    } else {
      await goGitIt(
        templateUrl,
        installationPath,
        messages.installingFromTemplate(projectName, templateName)
      )

      templatePath = path.join(installationPath, templateName)
    }

    if (projectName !== templateName) {
      // Move contents from templatePath to projectPath
      await utils.moveDirectoryContents(templatePath, projectPath)
    } else {
      // Handle the templatePath/templateName situation
      const tempPath = path.join(installationPath, projectName + '-temp')
      await fs.rename(templatePath, tempPath)

      // Move contents from tempPath/templateName to projectPath
      const srcPath = path.join(tempPath, templateName)
      await utils.moveDirectoryContents(srcPath, projectPath)

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
