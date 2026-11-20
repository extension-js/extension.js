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
import {CODES} from '../lib/messaging'
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
const HIDDEN_FILES_TEMPLATES_SHIP: Record<
  string,
  (projectName: string) => string
> = {
  '.gitignore': messages.keepingExistingGitignore,
  '.mcp.json': messages.keepingExistingMcpConfig
}

export async function createDirectory(
  projectPath: string,
  projectName: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
): Promise<CreateDirectoryResult> {
  logger.log(messages.startingNewExtension(projectName))

  // Recorded before directoryWriteFailure mkdirs the path, this is the only
  // place that still knows whether the directory pre-existed.
  const directoryPreExisted = existsSync(projectPath)

  try {
    const writeFailure = await utils.directoryWriteFailure(projectPath)

    if (writeFailure) {
      throw utils.failStep(
        messages.destinationNotWriteable(projectPath, writeFailure),
        writeFailure,
        CODES.E_DESTINATION_NOT_WRITABLE
      )
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

      throw new utils.CreateError(
        conflictMessage,
        CODES.E_DESTINATION_NOT_EMPTY
      )
    }

    for (const [hidden, keeping] of Object.entries(
      HIDDEN_FILES_TEMPLATES_SHIP
    )) {
      if (currentDir.includes(hidden)) {
        logger.log(keeping(projectName))
      }
    }
  } catch (error) {
    // A step that already rendered its own block keeps it. Wrapping it again
    // prints a second glyph and a remedy that has nothing to do with the cause.
    throw utils.failStep(
      messages.createDirectoryError(projectName, error),
      error,
      // The listing and the checks after it read the destination, so a fault
      // here has the same fix as a destination that refuses the write.
      CODES.E_DESTINATION_NOT_WRITABLE
    )
  }

  return {directoryCreated: !directoryPreExisted}
}
