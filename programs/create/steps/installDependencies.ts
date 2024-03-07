//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import {spawn} from 'cross-spawn'
import {bold, red} from '@colors/colors/safe'

import {getInstallCommand, getInstallArgs} from '../helpers/getInstallInfo'
import createSymlink from './symlinkExtensionCreate'

export default async function installDependencies(
  workingDir: string,
  projectName: string
) {
  const command = getInstallCommand()
  const projectPath = path.join(workingDir, projectName)
  const dependenciesArgs = getInstallArgs(projectPath)

  console.log('🛠  - Installing dependencies...')

  if (process.env.EXTENSION_ENV === 'development') {
    await createSymlink(workingDir, projectName)
    return
  }

  try {
    const child = spawn(command, dependenciesArgs, {stdio: 'inherit'})

    await new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(
              // eslint-disable-next-line @typescript-eslint/no-base-to-string
              {command: `${command} ${dependenciesArgs.join(' ')}`}.toString()
            )
          )
        } else {
          resolve()
        }
      })
      child.on('error', (error) => {
        console.log(error)
        reject(error)
      })
    })
  } catch (error: any) {
    console.error(
      `🧩 ${bold(`extension-create`)} ${red(
        `✖︎✖︎✖︎`
      )} Can't install dependencies for ${bold(projectName)}. ${error}`
    )

    process.exit(1)
  }
}
