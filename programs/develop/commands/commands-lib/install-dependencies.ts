import path from 'path'
import {spawn} from 'cross-spawn'
import fs from 'fs'
import {detect} from 'package-manager-detector'
import * as messages from './messages'
import {isFromPnpx} from '../../webpack/lib/utils'

export async function getInstallCommand() {
  const pm = await detect()

  let command = 'npm'

  if (isFromPnpx()) {
    return 'pnpm'
  }

  switch (pm?.name) {
    case 'yarn':
      command = 'yarn'
      break
    case 'pnpm':
      command = 'pnpm'
      break
    default:
      command = 'npm'
  }

  return command
}

function getInstallArgs() {
  return ['install' /*, '--silent' */]
}

export async function installDependencies(projectPath: string) {
  const nodeModulesPath = path.join(projectPath, 'node_modules')

  const command = await getInstallCommand()
  const dependenciesArgs = getInstallArgs()

  const originalDirectory = process.cwd()

  try {
    // Change to the project directory
    process.chdir(projectPath)

    // Create the node_modules directory if it doesn't exist
    await fs.promises.mkdir(nodeModulesPath, {recursive: true})

    const stdio =
      process.env.EXTENSION_ENV === 'development' ? 'inherit' : 'ignore'
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
