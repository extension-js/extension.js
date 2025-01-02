import fs from 'fs'
import path from 'path'
import {spawnSync} from 'child_process'

/**
 * Checks if Xcode command-line tools are installed by verifying the presence of 'xcode-select'.
 * Throws an error if not installed.
 */
export function checkXcodeCommandLineTools(): void {
  const result = spawnSync('xcode-select', ['-p'])
  if (result.error || result.status !== 0) {
    throw new Error(
      'Xcode command-line tools are not installed. Please install them using "xcode-select --install".'
    )
  }
}

/**
 * Ensures that the specified 'xcode' directory exists.
 * Logs whether the directory was found or created.
 * @param basePath - The base path where the 'xcode' directory should reside.
 * @returns The full path to the 'xcode' directory.
 */
export function ensureXcodeDirectory(basePath: string): string {
  const xcodeDir = path.join(basePath, 'xcode')
  if (!fs.existsSync(xcodeDir)) {
    fs.mkdirSync(xcodeDir, {recursive: true})
    console.log(`'xcode' directory was not found. Created at: ${xcodeDir}`)
  } else {
    console.log(`'xcode' directory already exists at: ${xcodeDir}`)
  }
  return xcodeDir
}

/**
 * Checks if the 'safari-web-extension-converter' tool is available.
 * Throws an error if the tool is not found.
 */
export function checkSafariWebExtensionConverter(): void {
  const result = spawnSync('xcrun', [
    '--find',
    'safari-web-extension-converter'
  ])
  if (result.error || result.status !== 0) {
    throw new Error(
      'The "safari-web-extension-converter" tool is not available. Please ensure Xcode is installed and configured correctly.'
    )
  }
}
