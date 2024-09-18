//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import {spawn} from 'cross-spawn'
import fs from 'fs'
import * as messages from '../lib/messages'

import * as utils from '../lib/utils'

function getInstallArgs() {
  return ['install', '--silent']
}

export async function installDependencies(
  projectPath: string,
  projectName: string
) {
  // In this case the node_modules directory is always created in the
  // root of projectPath so no need to use cwd.
  const nodeModulesPath = path.join(projectPath, 'node_modules')

  const command = await utils.getInstallCommand()
  const dependenciesArgs = getInstallArgs()

  console.log(messages.installingDependencies())

  try {
    const originalDirectory = process.cwd()

    // Change to the project directory
    process.chdir(projectPath)

    // Create the node_modules directory if it doesn't exist
    await fs.promises.mkdir(nodeModulesPath, {recursive: true})

    const stdio =
      process.env.EXTENSION_ENV === 'development' ? 'inherit' : 'ignore'
    const child = spawn(command, dependenciesArgs, {stdio})

    await new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        // Change back to the original directory
        process.chdir(originalDirectory)

        if (code !== 0) {
          reject(
            new Error(
              messages.installingDependenciesFailed(
                command,
                dependenciesArgs,
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
          messages.installingDependenciesProcessError(projectName, error)
        )
        reject(error)
      })
    })
  } catch (error: any) {
    console.error(messages.cantInstallDependencies(projectName, error))

    process.exit(1)
  }
}
