//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

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

  try {
    const stdio =
      process.env.EXTENSION_ENV === 'development' ? 'inherit' : 'ignore'
    const child = spawn(gitCommand, gitArgs, {
      stdio,
      cwd: projectPath
    })

    await new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(
              messages.initializingGitForRepositoryFailed(
                gitCommand,
                gitArgs,
                code
              )
            )
          )
        } else {
          resolve()
        }
      })

      child.on('error', (error) => {
        logger.error(
          messages.initializingGitForRepositoryProcessError(projectName, error)
        )
        reject(error)
      })
    })
  } catch (error: any) {
    logger.error(messages.initializingGitForRepositoryError(projectName, error))
    throw error
  }
}
