//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import fs from 'fs/promises'
import {bold, red, underline} from '@colors/colors/safe'

export default async function directoryHasConflicts(
  projectPath: string,
  conflictingFiles: string[]
) {
  const projectName = path.basename(projectPath)

  console.error(
    bold(
      red(
        `\nConflict! Path to ${underline(
          projectName
        )} includes conflicting files:\n`
      )
    )
  )

  for (const file of conflictingFiles) {
    const stats = await fs.lstat(path.join(projectPath, file))

    console.error(stats.isDirectory() ? `📁 - ${file}` : `    📄 - ${file}`)
  }

  console.error(
    '\nYou need to either rename/remove the files listed above, ' +
      'or choose a new directory name for your extension.'
  )

  console.error(
    `\n${bold('Path to conflicting directory')}: \`${underline(projectPath)}\``
  )
}
