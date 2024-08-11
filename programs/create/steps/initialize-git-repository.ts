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
  const gitArgs = ['init']

  console.log(messages.initializingGitForRepository(projectName))

  try {
    const originalDirectory = process.cwd()

    // Change to the project directory
    process.chdir(projectPath)

    const stdio =
      process.env.EXTENSION_ENV === 'development' ? 'inherit' : 'ignore'
    const child = spawn(gitCommand, gitArgs, {stdio})

    await new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        // Change back to the original directory
        process.chdir(originalDirectory)

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
        // Change back to the original directory
        process.chdir(originalDirectory)

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

    process.exit(1)
  }
}
