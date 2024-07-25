//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import fs from 'fs/promises'
import {bold, red} from '@colors/colors/safe'
import * as messages from '../messages'
import isDirectoryWriteable from '../helpers/isDirectoryWriteable'

const allowlist = ['LICENSE', 'node_modules']

export default async function createDirectory(
  projectPath: string,
  projectName: string
) {
  console.log(`🐣 - Starting a new browser extension named ${projectName}...`)

  try {
    const isCurrentDirWriteable = await isDirectoryWriteable(
      projectPath,
      projectName
    )

    console.log('🤞 - Checking if destination path is writeable...')
    if (!isCurrentDirWriteable) {
      messages.destinationNotWriteable(projectPath)
      process.exit(1)
    }

    const currentDir = await fs.readdir(projectPath)

    console.log('🔎 - Scanning for potential conflicting files...')
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
      await messages.directoryHasConflicts(projectPath, conflictingFiles)
      process.exit(1)
    }
  } catch (error: any) {
    console.error(
      `🧩 ${`Extension.js`} ${red(
        `✖︎✖︎✖︎`
      )} Can't create directory ${projectName}. ${error}`
    )
    process.exit(1)
  }
}
