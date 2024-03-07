//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import {bold, red, blue} from '@colors/colors/safe'
import copyDirectory from '../helpers/copyDirectory'

const templatesDir = path.resolve(__dirname, 'templates')

export default async function importLocalTemplate(
  workingDir: string,
  projectName: string,
  template: string
) {
  const localTemplatePath = path.join(templatesDir, template, 'template')
  const projectPath = path.join(workingDir, projectName)

  try {
    console.log(
      `🧰 - Installing ${bold(projectName)} from ${blue(
        bold(template)
      )} template...`
    )
    await copyDirectory(localTemplatePath, projectPath)
  } catch (error: any) {
    console.error(
      `🧩 ${bold(`extension-create`)} ${red(
        `✖︎✖︎✖︎`
      )} Can't copy template ${blue(bold(template))} for ${bold(
        projectName
      )}. ${error}`
    )
    process.exit(1)
  }
}
