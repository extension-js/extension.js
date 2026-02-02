// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import * as messages from './messages'
import {
  buildInstallCommand,
  execInstallCommand,
  resolvePackageManager
} from './package-manager'
import {shouldShowProgress, startProgressBar} from './progress'

export async function getInstallCommand() {
  return resolvePackageManager({cwd: process.cwd()}).name
}

function getInstallArgs() {
  return ['install' /*, '--silent' */]
}

export async function installDependencies(projectPath: string) {
  const nodeModulesPath = path.join(projectPath, 'node_modules')

  const originalDirectory = process.cwd()
  const progressLabel = messages.installingDependencies()

  try {
    // Change to the project directory before detecting package manager
    process.chdir(projectPath)

    const pm = resolvePackageManager({cwd: process.cwd()})
    let dependenciesArgs = getInstallArgs()
    // Ensure devDependencies are installed even if npm production config is set
    if (pm.name === 'npm') {
      dependenciesArgs = [...dependenciesArgs, '--include=dev']
    }

    // Create the node_modules directory if it doesn't exist
    await fs.promises.mkdir(nodeModulesPath, {recursive: true})

    const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
    const stdio = isAuthor ? 'inherit' : 'ignore'
    const progressEnabled = !isAuthor && shouldShowProgress()
    const progress = startProgressBar(progressLabel, {enabled: progressEnabled})

    if (!progressEnabled) {
      console.log(progressLabel)
    }

    if (isAuthor) {
      console.warn(messages.authorInstallNotice('project dependencies'))
    }

    const command = buildInstallCommand(pm, dependenciesArgs)
    try {
      await execInstallCommand(command.command, command.args, {
        cwd: projectPath,
        stdio
      })
    } finally {
      progress.stop()
    }
  } catch (error: any) {
    console.error(messages.cantInstallDependencies(error))
    process.exit(1)
  } finally {
    // Ensure we revert to the original directory even if an error occurs
    process.chdir(originalDirectory)
  }
}
