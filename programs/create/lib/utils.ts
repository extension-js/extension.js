//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import * as fs from 'fs/promises'
import * as path from 'path'
import {fileURLToPath} from 'url'
import {detect} from 'package-manager-detector'
import * as messages from './messages'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

export async function copyDirectoryWithSymlinks(
  source: string,
  destination: string
) {
  const entries = await fs.readdir(source, {withFileTypes: true})
  await fs.mkdir(destination, {recursive: true})

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name)
    const destPath = path.join(destination, entry.name)

    if (entry.isDirectory()) {
      await copyDirectoryWithSymlinks(sourcePath, destPath)
    } else if (entry.isSymbolicLink()) {
      const target = await fs.readlink(sourcePath)
      await fs.symlink(target, destPath)
    } else {
      await fs.copyFile(sourcePath, destPath)
    }
  }
}

export async function moveDirectoryContents(
  source: string,
  destination: string
) {
  await fs.mkdir(destination, {recursive: true})

  const entries = await fs.readdir(source, {withFileTypes: true})

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name)
    const destPath = path.join(destination, entry.name)

    if (entry.isDirectory()) {
      // Recursively move subdirectories
      await moveDirectoryContents(sourcePath, destPath)
    } else if (entry.isSymbolicLink()) {
      const target = await fs.readlink(sourcePath)
      await fs.symlink(target, destPath)
    } else {
      // Move files
      await fs.rename(sourcePath, destPath)
    }
  }

  // Remove the now-empty source directory
  await fs.rm(source, {recursive: true, force: true})
}

export async function getInstallCommand() {
  const pm = await detect()

  let command = 'npm'

  if (process.env.npm_config_user_agent) {
    if (process.env.npm_config_user_agent.includes('pnpm')) {
      return 'pnpm'
    }
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

export function getTemplatePath(workingDir: string) {
  const templatesDir = path.resolve(__dirname, '..', 'template')
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
