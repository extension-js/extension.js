//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import * as path from 'path'
import * as fs from 'fs/promises'
import * as messages from '../lib/messages'
import * as utils from '../lib/utils'

const allowlist = ['LICENSE', 'node_modules']

export async function createDirectory(
  projectPath: string,
  projectName: string
) {
  console.log(messages.startingNewExtension(projectName))

  try {
    const isCurrentDirWriteable = await utils.isDirectoryWriteable(
      projectPath,
      projectName
    )

    console.log(messages.checkingIfPathIsWriteable())

    if (!isCurrentDirWriteable) {
      console.error(messages.destinationNotWriteable(projectPath))
      process.exit(1)
    }

    const currentDir = await fs.readdir(projectPath)

    console.log(messages.scanningPossiblyConflictingFiles())

    const conflictingFiles = await Promise.all(
      currentDir
        // .gitignore, .DS_Store, etc
        .filter((file) => !file.startsWith('.'))
        // Logs of yarn/npm
        .filter((file) => !file.endsWith('.log'))
        // Whatever we think is appropriate
        .filter((file) => !allowlist.includes(file))
        .map(async (file) => {
          const stats = await fs.lstat(path.join(projectPath, file))
          return stats.isDirectory() ? `${file}/` : `${file}`
        })
    )

    // If directory has conflicting files, abort
    if (conflictingFiles.length > 0) {
      const conflictMessage = await messages.directoryHasConflicts(
        projectPath,
        conflictingFiles
      )
      throw new Error(conflictMessage)
    }
  } catch (error: any) {
    console.error(messages.createDirectoryError(projectName, error))
    process.exit(1)
  }
}
