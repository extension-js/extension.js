import fs from 'fs'
import path from 'path'
import {StatsAsset} from '@rspack/core'
import chalk from 'chalk'
import {Manifest} from '../../types'
import {type StartOptions, type DevOptions} from '../commands-lib/config-types'

function getLoggingPrefix(type: 'warn' | 'info' | 'error' | 'success'): string {
  const arrow =
    type === 'warn'
      ? chalk.yellow('►►►')
      : type === 'info'
        ? chalk.cyan('►►►')
        : type === 'error'
          ? chalk.bold.red('ERROR') +
            ' in ' +
            chalk.red('Extension.js') +
            chalk.red('✖︎✖︎✖︎')
          : chalk.green('►►►')
  // return `🧩 ${'Extension.js'} ${arrow}`
  return `${arrow}`
}

export function manifestNotFoundError(manifestPath: string) {
  return (
    `${getLoggingPrefix('error')} Manifest file not found.\n\n` +
    'Ensure the path to your extension exists and try again.\n' +
    `${chalk.red('NOT FOUND')} ${chalk.underline(manifestPath)}`
  )
}

export function building(browser: DevOptions['browser']): string {
  const extensionOutput =
    browser === 'firefox' || browser === 'gecko-based' ? 'Add-on' : 'Extension'

  return (
    `${getLoggingPrefix('info')} Building ${capitalizedBrowserName(browser)} ` +
    `${extensionOutput} package...`
  )
}

export function runningInProduction(
  projectDir: string,
  options: StartOptions
): string {
  const outputPath = path.join(projectDir, 'dist')
  const manifestPath = path.join(outputPath, 'manifest.json')
  const manifest: Record<string, any> = JSON.parse(
    fs.readFileSync(manifestPath, 'utf-8')
  )

  const {name, version, hostPermissions, permissions} = manifest

  const hasHost = hostPermissions && hostPermissions.length
  const hasPermissions = permissions && permissions.length

  const packageVersion = JSON.parse(
    fs.readFileSync('../../package.json', 'utf-8')
  ).version

  return `
 🧩 ${chalk.green('Extension.js')} ${chalk.gray(`${packageVersion}`)}
${`    Extension Name        `} ${chalk.gray(name)}
${`    Extension Version     `} ${chalk.gray(version)}
${`    Host Permissions      `} ${chalk.gray(
    hasHost ? hostPermissions.join(', ') : 'Browser defaults'
  )}
${`    Permissions           `} ${chalk.gray(
    hasPermissions ? permissions.join(', ') : 'Browser defaults'
  )}
`
}

export function ready(
  mode: DevOptions['mode'],
  browser: DevOptions['browser']
) {
  const modeColor = mode === 'production' ? chalk.blue : chalk.blue
  const extensionOutput =
    browser === 'firefox' || browser === 'gecko-based' ? 'Add-on' : 'Extension'

  return (
    `${getLoggingPrefix('success')} ` +
    `${capitalizedBrowserName(browser)} ${extensionOutput} ready for ` +
    `${modeColor(mode || 'unknown')}.`
  )
}

export function previewing(browser: DevOptions['browser']) {
  return `${getLoggingPrefix(
    'info'
  )} Previewing the extension on ${capitalizedBrowserName(browser)}...`
}

export function previewWebpack() {
  return `${getLoggingPrefix('info')} Previewing the extension package...`
}

export function buildWebpack(
  projectDir: string,
  stats: any,
  browser: DevOptions['browser']
): string {
  const statsJson = stats?.toJson()
  const manifestPath = path.join(projectDir, 'manifest.json')
  const manifest: Record<string, string> = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8')
  )
  const assets: any[] = statsJson?.assets
  const heading = `${getLoggingPrefix('info')} Building ${chalk.cyan(
    manifest.name
  )} extension using ${capitalizedBrowserName(browser)} defaults...\n\n`
  const buildTime = `\nBuild completed in ${(
    (statsJson?.time || 0) / 1000
  ).toFixed(2)} seconds.`
  const buildTarget = `Build Target: ${chalk.gray(capitalizedBrowserName(browser))}\n`
  const buildStatus = `Build Status: ${
    stats?.hasErrors() ? chalk.red('Failed') : chalk.green('Success')
  }\n`
  const version = `\nVersion: ${chalk.gray(manifest.version)}\n`
  const size = `Size: ${chalk.gray(getAssetsSize(assets))}\n`

  let output = ''
  output += heading
  output += getAssetsTree(assets)
  output += version
  output += size
  output += buildTarget
  output += buildStatus
  output += buildTime

  return output
}

export function buildSuccess() {
  return `${getLoggingPrefix(
    'success'
  )} No errors or warnings found. Your extension is ${chalk.green(
    'ready for deployment'
  )}.`
}

export function fetchingProjectPath(owner: string, project: string) {
  return (
    `${getLoggingPrefix('info')} Fetching data...\n` +
    `${chalk.gray('URL')} ${chalk.underline(`https://github.com/${owner}/${project}`)}`
  )
}

export function downloadingProjectPath(projectName: string) {
  return `${getLoggingPrefix('info')} Downloading ${chalk.cyan(projectName)}...`
}

export function creatingProjectPath(projectPath: string) {
  return (
    `\n${getLoggingPrefix('info')} Creating a new browser extension...\n` +
    `${chalk.gray('PATH')} ${chalk.underline(`${projectPath}`)}`
  )
}

export function noGitIgnoreFound(projectDir: string) {
  return (
    `${getLoggingPrefix('info')} No ${chalk.yellow('.gitignore')} found, ` +
    `zipping all the content inside path:\n` +
    `${chalk.gray('PATH')} ${chalk.underline(projectDir)}`
  )
}

export function packagingSourceFiles(zipPath: string) {
  return (
    `${getLoggingPrefix('info')} Packaging source files. ` +
    `Files in ${chalk.yellow('.gitignore')} will be excluded...\n` +
    `${chalk.gray('PATH')} ${chalk.underline(zipPath)}.`
  )
}

export function packagingDistributionFiles(zipPath: string) {
  return (
    `${getLoggingPrefix('info')} Packaging extension distribution files...\n` +
    `${chalk.gray('PATH')} ${chalk.underline(zipPath)}`
  )
}

export function treeWithSourceAndDistFiles(
  browser: DevOptions['browser'],
  name: string,
  sourceZip: string,
  destZip: string
) {
  return (
    `${'📦 Package name:'} ${chalk.yellow(
      `${name}`
    )}, ${'Target Browser:'} ${`${capitalizedBrowserName(browser)}`}` +
    `\n   ${chalk.gray('└─')} ${chalk.underline(`${sourceZip}`)} (source)` +
    `\n   ${chalk.gray('└─')} ${chalk.underline(`${destZip}`)} (distribution)`
  )
}

export function treeWithDistFilesbrowser(
  name: string,
  ext: string,
  browser: DevOptions['browser'],
  zipPath: string
) {
  return (
    `${'📦 Package name:'} ${chalk.yellow(`${name}.${ext}`)}, ` +
    `${'Target Browser:'} ${`${capitalizedBrowserName(browser)}`}` +
    `\n   ${chalk.gray('└─')} ${chalk.underline(`${zipPath}`)} ${chalk.gray('(distribution)')}`
  )
}

export function treeWithSourceFiles(
  name: string,
  ext: string,
  browser: DevOptions['browser'],
  zipPath: string
) {
  return (
    `${'📦 Package name:'} ${chalk.yellow(`${name}-source.${ext}`)}, ` +
    `${'Target Browser:'} ${`${capitalizedBrowserName(browser)}`}` +
    `\n   ${chalk.gray('└─')} ${chalk.underline(`${zipPath}`)} (source)`
  )
}

export function failedToCompressError(error: any) {
  return `${getLoggingPrefix(
    'error'
  )} Failed to compress extension package.\n${chalk.red(error)}`
}

export function writingTypeDefinitions(manifest: Manifest) {
  return (
    `${getLoggingPrefix('info')} ` +
    `Writing type definitions for ${chalk.cyan(manifest.name || '')}...`
  )
}

export function writingTypeDefinitionsError(error: any) {
  return `${getLoggingPrefix(
    'error'
  )} Failed to write the extension type definition.\n${chalk.red(error)}`
}

export function downloadingText(url: string) {
  return (
    `${getLoggingPrefix('info')} Downloading extension...\n` +
    `${chalk.gray('URL')} ${chalk.underline(url)}`
  )
}

export function unpackagingExtension(zipFilePath: string) {
  return (
    `${getLoggingPrefix('info')} Unpackaging browser extension...\n` +
    `${chalk.gray('PATH')} ${chalk.underline(zipFilePath)}`
  )
}

export function unpackagedSuccessfully() {
  return `${getLoggingPrefix(
    'info'
  )} Browser extension unpackaged ${chalk.green('successfully')}.`
}

export function failedToDownloadOrExtractZIPFileError(error: any) {
  return (
    `${getLoggingPrefix('error')} ` +
    `Failed to download or extract ZIP file. ${chalk.red(error)}`
  )
}

// function calculateDirectorySize(dirPath: string): number {
//   let totalSize = 0

//   const items = fs.readdirSync(dirPath)

//   for (const item of items) {
//     const fullPath = path.join(dirPath, item)
//     const stats = fs.statSync(fullPath)

//     if (stats.isFile()) {
//       totalSize += stats.size
//     } else if (stats.isDirectory()) {
//       totalSize += calculateDirectorySize(fullPath)
//     }
//   }

//   return totalSize
// }

function capitalizedBrowserName(browser: DevOptions['browser']) {
  return browser!.charAt(0).toUpperCase() + browser!.slice(1)
}

function getFileSize(fileSizeInBytes: number): string {
  return `${(fileSizeInBytes / 1024).toFixed(2)}KB`
}

function getAssetsSize(assets: {size: number}[] | undefined) {
  let totalSize = 0
  assets?.forEach((asset) => {
    totalSize += asset.size
  })

  return getFileSize(totalSize)
}

// function getDirectorySize(filepath: string): string {
//   const fileSizeInBytes = calculateDirectorySize(filepath)
//   const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
//   const sizeType = Math.floor(Math.log(fileSizeInBytes) / Math.log(1024))
//   const size = (fileSizeInBytes / Math.pow(1024, sizeType)).toFixed(1)

//   return `${size} ${sizes[sizeType]}`
// }

function printTree(node: Record<string, any>, prefix = ''): string {
  let output = ''

  Object.keys(node).forEach((key, index, array) => {
    const isLast = index === array.length - 1
    const connector = isLast ? '└─' : '├─'
    const sizeInKB = node[key].size
      ? ` (${getFileSize(node[key].size as number)})`
      : ''
    output += `${chalk.gray(prefix)}${chalk.gray(connector)} ${key}${chalk.gray(sizeInKB)}\n`
    if (typeof node[key] === 'object' && !node[key].size) {
      output += printTree(
        node[key],
        `${prefix}${isLast ? '   ' : chalk.gray('│  ')}`
      )
    }
  })

  return output
}

function getAssetsTree(assets: StatsAsset[] | undefined): string {
  const assetTree: Record<string, {size: number}> = {}

  assets?.forEach((asset) => {
    const paths = asset.name.split('/')
    let currentLevel: any = assetTree

    paths.forEach((part, index) => {
      if (!currentLevel[part]) {
        currentLevel[part] = {}
      }
      if (index === paths.length - 1) {
        // Last part of the path, add size info
        currentLevel[part] = {size: asset.size}
      } else {
        currentLevel = currentLevel[part]
      }
    })
  })

  return `.\n${printTree(assetTree)}`
}

export function isUsingExperimentalConfig(integration: any) {
  return (
    `${getLoggingPrefix('info')} ` +
    `Using ${chalk.magenta(integration)}. ` +
    `${chalk.yellow('This is very experimental')}.`
  )
}

export function installingDependencies() {
  return `${getLoggingPrefix('info')} ` + `Installing project dependencies...`
}

export function installingDependenciesFailed(
  gitCommand: string,
  gitArgs: string[],
  code: number | null
) {
  return (
    `${getLoggingPrefix('error')} Command ${gitCommand} ${gitArgs.join(' ')} ` +
    `failed with exit code ${code}`
  )
}

export function installingDependenciesProcessError(error: any) {
  return (
    `${getLoggingPrefix('error')} Child process error: Can't ` +
    `install project dependencies.\n${chalk.red(error)}`
  )
}

export function cantInstallDependencies(error: any) {
  return (
    `${getLoggingPrefix('error')} Can't install project dependencies. ` +
    `${chalk.red(error.message || error.toString())}`
  )
}
