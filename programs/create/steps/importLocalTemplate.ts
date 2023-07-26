//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import copyDirectory from '../helpers/copyDirectory'

const templatesDir = path.resolve(__dirname, '../templates')

export default async function importLocalTemplate(
  workingDir: string,
  projectName: string,
  template: string
) {
  const localTemplatePath = path.join(templatesDir, template, 'template')
  const projectPath = path.join(workingDir, projectName)

  try {
    console.log(
      `🧰 - Installing **${projectName}** from \`${template}\` template...`
    )
    await copyDirectory(localTemplatePath, projectPath)
  } catch (error: any) {
    console.error(`😕❓ Can't copy template __${template}__: ${error}`)
    process.exit(1)
  }
}
