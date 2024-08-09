import path from 'path'
import fs from 'fs'
import {StatsAsset} from 'webpack'
import {
  gray,
  red,
  brightYellow,
  brightGreen,
  underline,
  magenta,
  brightBlue
} from '@colors/colors/safe'
import {Manifest} from '../../types'
import {StartOptions} from '../start'
import {DevOptions} from '../dev'

function getLoggingPrefix(type: 'warn' | 'info' | 'error' | 'success'): string {
  const arrow =
    type === 'warn'
      ? brightYellow('►►►')
      : type === 'info'
        ? brightBlue('►►►')
        : type === 'error'
          ? red('✖︎✖︎✖︎')
          : brightGreen('►►►')
  // return `🧩 ${'Extension.js'} ${arrow}`
  return `${arrow}`
}

export function manifestNotFound() {
  return (
    `${getLoggingPrefix('error')} Manifest file not found. ` +
    'Ensure the path to your extension exists and try again.'
  )
}

export function building(browser: DevOptions['browser']): string {
  const extensionOutput = browser === 'firefox' ? 'Add-on' : 'Extension'

  return (
    `${getLoggingPrefix('info')} Building ${capitalizedBrowserName(browser)} ` +
    `${extensionOutput} package...`
  )
}

export function runningInProduction(
  projectDir: string,
  options: StartOptions
): string {
  const outputPath = path.join(projectDir, 'dist', options.browser || 'chrome')
  const manifestPath = path.join(outputPath, 'manifest.json')
  const manifest: Record<string, any> = require(manifestPath)

  const {name, version, hostPermissions, permissions} = manifest

  const defaultLocale = getLocales(projectDir, manifest).defaultLocale
  const otherLocales = getLocales(projectDir, manifest).otherLocales.join(', ')
  const locales = `${defaultLocale} ${otherLocales && ', ' + otherLocales}`
  const hasHost = hostPermissions && hostPermissions.length
  const hasPermissions = permissions && permissions.length

  const packageVersion = require('../../package.json').version

  return `
 🧩 ${brightGreen('Extension.js')} ${gray(`${packageVersion}`)}
${`    Extension Name        `} ${gray(name)}
${`    Extension Version     `} ${gray(version)}
${`    Locales               `} ${gray(locales)}
${`    Host Permissions      `} ${gray(hasHost ? hostPermissions.join(', ') : 'Browser defaults')}
${`    Permissions           `} ${gray(hasPermissions ? permissions.join(', ') : 'Browser defaults')}
`
}

export function ready(
  mode: DevOptions['mode'],
  browser: DevOptions['browser']
) {
  const modeColor = mode === 'production' ? magenta : magenta
  const extensionOutput = browser === 'firefox' ? 'Add-on' : 'Extension'

  return (
    `${getLoggingPrefix('success')} ` +
    `${capitalizedBrowserName(browser)} ${extensionOutput} running in ` +
    `${modeColor(mode || 'unknown')} mode.`
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
  const heading = `${getLoggingPrefix('info')} Building ${brightGreen(
    manifest.name
  )} extension using ${capitalizedBrowserName(browser)} defaults...\n\n`
  const buildTime = `\nBuild completed in ${(
    (statsJson?.time || 0) / 1000
  ).toFixed(2)} seconds.\n`
  const buildTarget = `Build Target: ${gray(capitalizedBrowserName(browser))}\n`
  const buildStatus = `Build Status: ${
    stats?.hasErrors() ? red('Failed') : brightGreen('Success')
  }\n`
  const version = `\nVersion: ${gray(manifest.version)}\n`
  const size = `Size: ${gray(getAssetsSize(assets))}\n`

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
  )} No errors or warnings found. Your extension is ${brightGreen('ready for deployment')}.`
}

export function fetchingProjectPath(owner: string, project: string) {
  return (
    `${getLoggingPrefix('success')} Fetching data...\n\n` +
    `${gray('URL')} ${underline(`https://github.com/${owner}/${project}`)}`
  )
}

export function downloadingProjectPath(projectName: string) {
  return `${getLoggingPrefix('success')} Downloading ${brightGreen(
    projectName
  )}...`
}

export function creatingProjectPath(projectName: string) {
  return (
    `\n${getLoggingPrefix('success')} Creating a new browser extension...\n\n` +
    `${gray('PATH')} ${underline(`${process.cwd()}/${projectName}`)}`
  )
}

export function noGitIgnoreFound(projectDir: string) {
  return (
    `${getLoggingPrefix('success')} No ${brightYellow('.gitignore')} found, ` +
    `zipping all the content inside path:\n\n` +
    `${gray('PATH')} ${underline(projectDir)}`
  )
}

export function packagingSourceFiles(zipPath: string) {
  return (
    `${getLoggingPrefix('success')} Packaging source files. ` +
    `Files in ${brightYellow('.gitignore')} will be excluded...\n\n` +
    `${gray('PATH')} ${underline(zipPath)}.`
  )
}

export function packagingDistributionFiles(zipPath: string) {
  return (
    `${getLoggingPrefix(
      'success'
    )} Packaging extension distribution files...\n\n` +
    `${gray('PATH')} ${underline(zipPath)}`
  )
}

export function treeWithSourceAndDistFiles(
  browser: DevOptions['browser'],
  name: string,
  sourceZip: string,
  destZip: string
) {
  return (
    `${'📦 Package name:'} ${brightYellow(
      `${name}`
    )}, ${'Target Browser:'} ${`${capitalizedBrowserName(browser)}`}` +
    `\n   ${'└─'} ${underline(`${sourceZip}`)} (source)` +
    `\n   ${'└─'} ${underline(`${destZip}`)} (distribution)`
  )
}

export function treeWithDistFilesbrowser(
  name: string,
  ext: string,
  browser: DevOptions['browser'],
  zipPath: string
) {
  return (
    `${'📦 Package name:'} ${brightYellow(`${name}.${ext}`)}, ` +
    `${'Target Browser:'} ${`${capitalizedBrowserName(browser)}`}` +
    `\n   ${'└─'} ${underline(`${zipPath}`)} (distribution)`
  )
}

export function treeWithSourceFiles(
  name: string,
  ext: string,
  browser: DevOptions['browser'],
  zipPath: string
) {
  return (
    `${'📦 Package name:'} ${brightYellow(`${name}-source.${ext}`)}, ` +
    `${'Target Browser:'} ${`${capitalizedBrowserName(browser)}`}` +
    `\n   ${'└─'} ${underline(`${zipPath}`)} (source)`
  )
}

export function failedToCompress(error: any) {
  return `${getLoggingPrefix(
    'error'
  )} Failed to compress extension package. ${error}`
}

export function writingTypeDefinitions(manifest: Manifest) {
  return (
    `${getLoggingPrefix('info')} ${manifest.name} (v${manifest.version}) ` +
    'has no type definitions. Writing...'
  )
}

export function writeTypeDefinitionsError(error: any) {
  return `${getLoggingPrefix(
    'error'
  )} Failed to write the extension type definition. ${red(error)}`
}

export function downloadingText(url: string) {
  return (
    `${getLoggingPrefix('success')} Downloading extension...\n\n` +
    `${gray('URL')} ${underline(url)}`
  )
}

export function unpackagingExtension(zipFilePath: string) {
  return (
    `${getLoggingPrefix('success')} Unpackaging browser extension...\n\n` +
    `${gray('PATH')} ${underline(zipFilePath)}`
  )
}

export function unpackagedSuccessfully() {
  return `${getLoggingPrefix(
    'success'
  )} Browser extension unpackaged successfully. Compiling...`
}

export function failedToDownloadOrExtractZIPFile(error: any) {
  return (
    `${getLoggingPrefix('error')} ` +
    `Failed to download or extract ZIP file. ${red(error)}`
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

function getLocales(projectPath: string, manifest: Record<string, any>) {
  const defaultLocale = manifest.default_locale as string

  // Get the list of all locale folders
  const localesDir = path.join(projectPath, '_locales')

  if (!fs.existsSync(localesDir)) {
    return {
      defaultLocale: 'Browser defaults',
      otherLocales: []
    }
  }

  const localeFolders = fs
    .readdirSync(localesDir)
    .filter((folder) => folder !== defaultLocale)

  return {
    defaultLocale,
    otherLocales: localeFolders
  }
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
    output += `${gray(prefix)}${gray(connector)} ${key}${gray(sizeInKB)}\n`
    if (typeof node[key] === 'object' && !node[key].size) {
      output += printTree(node[key], `${prefix}${isLast ? '   ' : '|  '}`)
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

export function isUsingExtensionConfig(integration: any) {
  return (
    `${getLoggingPrefix('info')} ` +
    `is using ${gray(integration)}. ` +
    `${brightYellow('This is very experimental')}.`
  )
}
