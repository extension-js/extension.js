//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import fs from 'fs/promises'
import path from 'path'
import {detect} from 'detect-package-manager'
import * as messages from './messages'

export async function copyDirectory(source: string, destination: string) {
  const directoryEntries = await fs.readdir(source, {withFileTypes: true})
  await fs.mkdir(destination, {recursive: true})

  return await Promise.all(
    directoryEntries.map(async (entry) => {
      const sourcePath = path.join(source, entry.name)
      const destinationPath = path.join(destination, entry.name)

      if (entry.isDirectory()) {
        await copyDirectory(sourcePath, destinationPath)
      } else {
        await fs.copyFile(sourcePath, destinationPath)
      }
    })
  )
}

export async function getInstallCommand() {
  const pm = await detect()

  let command = 'npm run'

  switch (pm) {
    case 'yarn':
      command = 'yarn'
      break
    case 'pnpm':
      command = 'pnpm run'
      break
    default:
      command = 'npm run'
  }

  return command
}

export function getTemplatePath(workingDir: string) {
  const templatesDir = path.resolve(__dirname, 'template')
  return path.resolve(workingDir, templatesDir)
}

export async function isDirectoryWriteable(
  directory: string,
  projectName: string
): Promise<boolean> {
  try {
    console.log(messages.folderExists(projectName))

    await fs.mkdir(directory, {recursive: true})

    return true
  } catch (err) {
    console.log(messages.writingDirectoryError(err))
    return false
  }
}

export function isExternalTemplate(templateName: string) {
  return templateName !== 'init'
}

export function isTypeScriptTemplate(templateName: string) {
  return (
    templateName.includes('typescript') ||
    templateName.includes('react') ||
    templateName.includes('preact') ||
    templateName.includes('svelte') ||
    templateName.includes('solid')
  )
}
