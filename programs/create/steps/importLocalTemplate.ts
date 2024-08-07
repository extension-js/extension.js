//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import {red, brightBlue} from '@colors/colors/safe'
import copyDirectory from '../helpers/copyDirectory'

const templatesDir = path.resolve(__dirname, 'templates')

export default async function importLocalTemplate(
  projectPath: string,
  projectName: string,
  template: string
) {
  const localTemplatePath = path.join(templatesDir, template, 'template')

  const isTemplate = template && template !== 'init'
  const fromTemplate = isTemplate
    ? ` from ${brightBlue(template)} template`
    : ''
  try {
    console.log(`🧰 - Installing ${projectName}` + fromTemplate + '...')
    await copyDirectory(localTemplatePath, projectPath)
  } catch (error: any) {
    console.error(
      `🧩 ${`Extension.js`} ${red(`✖︎✖︎✖︎`)} Can't copy template ${brightBlue(
        template
      )} for ${projectName}. ${error}`
    )
    process.exit(1)
  }
}
