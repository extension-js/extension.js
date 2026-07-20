//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawn} from 'cross-spawn'
import * as messages from '../lib/messages'

export async function initializeGitRepository(
  projectPath: string,
  projectName: string,
  logger: {log(...args: any[]): void; error(...args: any[]): void}
) {
  const gitCommand = 'git'
  const gitArgs = ['init', '--quiet']

  logger.log(messages.initializingGitForRepository(projectName))

  const stdio =
    process.env.EXTENSION_ENV === 'development' ? 'inherit' : 'ignore'
  const child = spawn(gitCommand, gitArgs, {
    stdio,
    cwd: projectPath
  })

  await new Promise<void>((resolve) => {
    child.on('close', (code) => {
      if (code !== 0) {
        logger.log(
          messages.initializingGitSkipped(
            projectName,
            `git exited with ${code}`
          )
        )
      }
      resolve()
    })

    child.on('error', (error: NodeJS.ErrnoException) => {
      const reason =
        error?.code === 'ENOENT'
          ? 'git not found'
          : String(error?.message || error)
      logger.log(messages.initializingGitSkipped(projectName, reason))
      resolve()
    })
  })
}
