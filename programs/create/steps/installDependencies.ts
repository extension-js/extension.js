//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import {spawn} from 'cross-spawn'
import fs from 'fs'
import {bold, red} from '@colors/colors/safe'

import {getInstallCommand} from '../helpers/getInstallInfo'
import createSymlink from './symlinkExtensionJs'

function getInstallArgs() {
  return ['install', '--silent']
}

export default async function installDependencies(
  projectPath: string,
  projectName: string
) {
  const nodeModulesPath = path.join(projectPath, 'node_modules')

  const command = getInstallCommand()
  const dependenciesArgs = getInstallArgs()

  console.log('🛠  - Installing dependencies...')

  // Symlink Extension for development
  if (process.env.EXTENSION_ENV === 'development') {
    await createSymlink(projectPath)
  }

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
              `Command ${command} ${dependenciesArgs.join(
                ' '
              )} failed with exit code ${code}`
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
          `🧩 ${`Extension.js`} ${red(
            `✖︎✖︎✖︎`
          )} Child process error: Can't install dependencies for ${
            projectName
          }. ${error.message}`
        )
        reject(error)
      })
    })
  } catch (error: any) {
    console.error(
      `🧩 ${`Extension.js`} ${red(
        `✖︎✖︎✖︎`
      )} Can't install dependencies for ${projectName}. ${
        error.message || error.toString()
      }`
    )

    process.exit(1)
  }
}
