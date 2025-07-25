//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import * as path from 'path'
import {spawn} from 'cross-spawn'
import * as fs from 'fs'
import * as messages from '../lib/messages'
import * as utils from '../lib/utils'

function getInstallArgs() {
  return ['install', '--silent']
}

export async function installDependencies(
  projectPath: string,
  projectName: string
) {
  const nodeModulesPath = path.join(projectPath, 'node_modules')

  const command = await utils.getInstallCommand()
  const dependenciesArgs = getInstallArgs()

  console.log(messages.installingDependencies())

  try {
    // Create the node_modules directory if it doesn't exist
    await fs.promises.mkdir(nodeModulesPath, {recursive: true})

    const stdio =
      process.env.EXTENSION_ENV === 'development' ? 'inherit' : 'ignore'
    const child = spawn(command, dependenciesArgs, {
      stdio,
      cwd: projectPath
    })

    await new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
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
        console.error(
          messages.installingDependenciesProcessError(projectName, error)
        )
        reject(error)
      })
    })
  } catch (error: any) {
    console.error(messages.cantInstallDependencies(projectName, error))
    throw error
  }
}
