// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import {spawn} from 'cross-spawn'
import * as fs from 'fs'
import * as messages from './messages'
import {getInstallCommandForPath} from './package-manager'

export async function getInstallCommand() {
  // Prefer explicit lockfiles in the current working directory
  // (we chdir(projectPath) before calling this)
  return getInstallCommandForPath(process.cwd())
}

function getInstallArgs() {
  return ['install' /*, '--silent' */]
}

export async function installDependencies(projectPath: string) {
  const nodeModulesPath = path.join(projectPath, 'node_modules')

  const originalDirectory = process.cwd()

  try {
    // Change to the project directory before detecting package manager
    process.chdir(projectPath)

    const command = await getInstallCommand()
    let dependenciesArgs = getInstallArgs()
    // Ensure devDependencies are installed even if npm production config is set
    if (command === 'npm') {
      dependenciesArgs = [...dependenciesArgs, '--include=dev']
    }

    // Create the node_modules directory if it doesn't exist
    await fs.promises.mkdir(nodeModulesPath, {recursive: true})

    const stdio =
      process.env.EXTENSION_AUTHOR_MODE === 'true' ? 'inherit' : 'ignore'
    const child = spawn(command, dependenciesArgs, {stdio})

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
        reject(error)
      })
    })
  } catch (error: any) {
    console.error(messages.cantInstallDependencies(error))
    process.exit(1)
  } finally {
    // Ensure we revert to the original directory even if an error occurs
    process.chdir(originalDirectory)
  }
}
