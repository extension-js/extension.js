//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import fs from 'fs/promises'
import {bold, blue} from '@colors/colors/safe'

export default async function importExternalTemplate(
  workingDir: string,
  projectName: string,
  template: string
) {
  const projectPath = path.join(workingDir, projectName)
  const templateName = path.basename(template)

  try {
    await fs.mkdir(projectPath, {recursive: true})

    console.log(
      `🧰 - Installing ${bold(projectName)} from template ${blue(
        bold(templateName)
      )}`
    )
  } catch (error: any) {
    console.error(
      `😕❓ Can't find template ${blue(bold(templateName))}. ${error}`
    )
    process.exit(1)
  }
}
