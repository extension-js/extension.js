//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs/promises'
import * as path from 'path'
import * as messages from './messages'
import {detectPackageManagerFromEnv} from './package-manager'

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
      try {
        const target = await fs.readlink(sourcePath)
        await fs.symlink(target, destPath)
      } catch (err: any) {
        if (err?.code === 'EPERM' || err?.code === 'ENOTSUP') {
          const real = await fs.realpath(sourcePath)
          await fs.cp(real, destPath, {recursive: true})
        } else {
          throw err
        }
      }
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
      try {
        const target = await fs.readlink(sourcePath)
        await fs.symlink(target, destPath)
      } catch (err: any) {
        if (err?.code === 'EPERM' || err?.code === 'ENOTSUP') {
          const real = await fs.realpath(sourcePath)
          await fs.cp(real, destPath, {recursive: true})
        } else {
          throw err
        }
      }
    } else {
      // Move files with EXDEV (cross-device) fallback to copy+unlink
      try {
        await fs.rename(sourcePath, destPath)
      } catch (err: any) {
        if (err && (err.code === 'EXDEV' || err.code === 'EINVAL')) {
          await fs.copyFile(sourcePath, destPath)
          await fs.rm(sourcePath, {force: true})
        } else {
          throw err
        }
      }
    }
  }

  // Remove the now-empty source directory
  await fs.rm(source, {recursive: true, force: true})
}

export async function getInstallCommand() {
  return detectPackageManagerFromEnv()
}

export async function isDirectoryWriteable(
  directory: string,
  projectName: string,
  logger: {log(...args: any[]): void; error(...args: any[]): void}
): Promise<boolean> {
  try {
    logger.log(messages.folderExists(projectName))

    await fs.mkdir(directory, {recursive: true})

    return true
  } catch (err) {
    logger.log(messages.writingDirectoryError(err))
    return false
  }
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
