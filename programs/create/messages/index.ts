//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import fs from 'fs/promises'
// @ts-ignore
import prefersYarn from 'prefers-yarn'
import {blue, green, underline} from '@colors/colors/safe'

export function destinationNotWriteable(workingDir: string) {
  const workingDirFolder = path.basename(workingDir)

  return (
    `Failed to write in the destination directory. Path for \`${workingDirFolder}\` is not writable.\n` +
    `Ensure you have write permissions for this folder.\nPath: ${workingDirFolder}`
  )
}

export async function directoryHasConflicts(
  projectPath: string,
  conflictingFiles: string[]
) {
  const projectName = path.basename(projectPath)
  let message = `\nConflict! Path to ${underline(projectName)} includes conflicting files:\n`

  for (const file of conflictingFiles) {
    const stats = await fs.lstat(path.join(projectPath, file))
    message += stats.isDirectory() ? `📁 - ${file}\n` : `📄 - ${file}\n`
  }

  message +=
    '\nYou need to either rename/remove the files listed above, ' +
    'or choose a new directory name for your extension.\n' +
    `\nPath to conflicting directory: \`${underline(projectPath)}\``

  return message
}

export function noProjectName() {
  return 'You need to provide an extension name to create one. \nSee `--help` for command info.'
}

export function noUrlAllowed() {
  return 'URLs are not allowed as a project path. Either write a name or a path to a local folder.'
}

export function successfullInstall(projectPath: string, projectName: string) {
  const relativePath = path.relative(process.cwd(), projectPath)

  const packageManager = prefersYarn() ? 'yarn' : 'npm run'
  return (
    `🧩 - ${green('Success!')} Extension ${projectName} created.\n` +
    `Now ${blue(`cd ${underline(relativePath)}`)} and ${blue(`${packageManager} dev`)} to open a new browser instance\n` +
    'with your extension installed, loaded, and enabled for development.\n' +
    '\nYou are ready. Time to hack on your extension!'
  )
}
