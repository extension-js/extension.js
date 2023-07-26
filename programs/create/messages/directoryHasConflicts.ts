//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import fs from 'fs/promises'

export default async function directoryHasConflicts(
  projectPath: string,
  conflictingFiles: string[]
) {
  const projectName = path.basename(projectPath)

  console.error(
    `Conflict! Directory \`${projectName}/\` includes conflicting files:`
  )

  for (const file of conflictingFiles) {
    const stats = await fs.lstat(path.join(projectPath, file))

    console.error(
      stats.isDirectory() ? `   📁 - ${file}` : `       📄 - ${file}`
    )
  }

  console.error(
    'You need to either rename/remove the files listed above,\n' +
      'or choose a new directory name for your extension.'
  )

  console.error(`Path to conflicting directory: \`${projectPath}\``)
}
