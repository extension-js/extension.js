//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {existsSync} from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as messages from '../lib/messages'
import * as utils from '../lib/utils'

const allowlist = ['LICENSE', 'node_modules']

export interface CreateDirectoryResult {
  // True when this run created projectPath itself. The conflict check below
  // tolerates dotfiles (`.git`), LICENSE, and node_modules, so a pre-existing
  // directory can pass as scaffold-ready while still holding user data that a
  // failure cleanup must never delete.
  directoryCreated: boolean
}

// Hidden files pass the conflict check so a repository can adopt the
// scaffold in place, but the ones a template ships are named up front
// rather than silently written over.
const HIDDEN_FILES_TEMPLATES_SHIP = ['.gitignore']

export async function createDirectory(
  projectPath: string,
  projectName: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
): Promise<CreateDirectoryResult> {
  logger.log(messages.startingNewExtension(projectName))

  // Recorded before isDirectoryWriteable mkdirs the path, this is the only
  // place that still knows whether the directory pre-existed.
  const directoryPreExisted = existsSync(projectPath)

  try {
    const isCurrentDirWriteable = await utils.isDirectoryWriteable(
      projectPath,
      logger
    )

    if (!isCurrentDirWriteable) {
      logger.error(messages.destinationNotWriteable(projectPath))
      throw new Error(messages.destinationNotWriteable(projectPath))
    }

    const currentDir = await fs.readdir(projectPath)

    const conflictingFiles = await Promise.all(
      currentDir
        .filter((file) => !file.startsWith('.'))
        .filter((file) => !file.endsWith('.log'))
        .filter((file) => !allowlist.includes(file))
        .map(async (file) => {
          const stats = await fs.lstat(path.join(projectPath, file))
          return stats.isDirectory() ? `${file}/` : `${file}`
        })
    )

    if (conflictingFiles.length > 0) {
      const conflictMessage = await messages.directoryHasConflicts(
        projectPath,
        conflictingFiles
      )
      throw new Error(conflictMessage)
    }

    for (const hidden of HIDDEN_FILES_TEMPLATES_SHIP) {
      if (currentDir.includes(hidden)) {
        logger.log(messages.keepingExistingGitignore(projectName))
      }
    }
  } catch (error) {
    // Re-throw a single formatted error so callers log it once
    throw new Error(messages.createDirectoryError(projectName, error))
  }

  return {directoryCreated: !directoryPreExisted}
}
