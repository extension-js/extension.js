//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs/promises'
import * as messages from '../lib/messages'
import * as utils from '../lib/utils'

const allowlist = ['LICENSE', 'node_modules']

export async function createDirectory(
  projectPath: string,
  projectName: string,
  logger: {log(...args: any[]): void; error(...args: any[]): void}
) {
  logger.log(messages.startingNewExtension(projectName))

  try {
    const isCurrentDirWriteable = await utils.isDirectoryWriteable(
      projectPath,
      projectName,
      logger
    )

    logger.log(messages.checkingIfPathIsWriteable())

    if (!isCurrentDirWriteable) {
      logger.error(messages.destinationNotWriteable(projectPath))
      throw new Error(messages.destinationNotWriteable(projectPath))
    }

    const currentDir = await fs.readdir(projectPath)

    logger.log(messages.scanningPossiblyConflictingFiles())

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
    // Re-throw a single formatted error so callers log it once
    throw new Error(messages.createDirectoryError(projectName, error))
  }
}
