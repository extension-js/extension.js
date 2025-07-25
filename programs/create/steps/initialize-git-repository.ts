//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import {spawn} from 'cross-spawn'
import * as messages from '../lib/messages'

export async function initializeGitRepository(
  projectPath: string,
  projectName: string
) {
  const gitCommand = 'git'
  const gitArgs = ['init', '--quiet']

  console.log(messages.initializingGitForRepository(projectName))

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
        console.error(
          messages.initializingGitForRepositoryProcessError(projectName, error)
        )
        reject(error)
      })
    })
  } catch (error: any) {
    console.error(
      messages.initializingGitForRepositoryError(projectName, error)
    )
    throw error
  }
}
