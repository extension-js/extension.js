import path from 'path'
import fs from 'fs'
import {StatsAsset} from 'webpack'
import {red, yellow, green, underline, magenta, blue} from '@colors/colors/safe'
import {Manifest} from '../../types'
import {StartOptions} from '../start'
import {DevOptions} from '../dev'

function getLoggingPrefix(type: 'warn' | 'info' | 'error' | 'success'): string {
  const arrow =
    type === 'warn'
      ? yellow('►►►')
      : type === 'info'
        ? blue('►►►')
        : type === 'error'
          ? red('✖︎✖︎✖︎')
          : green('►►►')
  return `🧩 ${'Extension.js'} ${arrow}`
}

function calculateDirectorySize(dirPath: string): number {
  let totalSize = 0

  const items = fs.readdirSync(dirPath)

  for (const item of items) {
    const fullPath = path.join(dirPath, item)
    const stats = fs.statSync(fullPath)

    if (stats.isFile()) {
      totalSize += stats.size
    } else if (stats.isDirectory()) {
      totalSize += calculateDirectorySize(fullPath)
    }
  }

  return totalSize
}

export function previewWebpack() {
  return `${getLoggingPrefix('info')} ` + `Previewing the extension package...`
}

export function manifestNotFound() {
  return (
    `${getLoggingPrefix('error')} ` +
    `Manifest file not found. Ensure the path to your extension exists and try again.`
  )
}

export function startWebpack(
  projectDir: string,
  options: StartOptions
): string {
  const outputPath = path.join(projectDir, 'dist', options.browser || 'chrome')
  const manifestPath = path.join(outputPath, 'manifest.json')
  const manifest: Record<string, any> = require(manifestPath)

  const {name, description, version, hostPermissions, permissions} = manifest

  const defaultLocale = getLocales(projectDir, manifest).defaultLocale
  const otherLocales = getLocales(projectDir, manifest).otherLocales.join(', ')
  const locales = `${defaultLocale} (default)${
    otherLocales && ', ' + otherLocales
  }`
  const hasHost = hostPermissions && hostPermissions.length
  const hasPermissions = permissions && permissions.length

  return `
${`• Name:`} ${name}
${description ? `${`• Description:`} ${description}\n` : ''}
${`• Version:`} ${version}
${`• Size:`} ${getDirectorySize(outputPath)}
${`• Locales:`} ${locales}
${`• Host Permissions:`} ${
    hasHost ? hostPermissions.sort().join(', ') : 'Browser defaults'
  }
${`• Permissions:`} ${
    hasPermissions ? permissions.sort().join(', ') : 'Browser defaults'
  }
  `
}

function capitalizedBrowserName(browser: DevOptions['browser']) {
  return browser!.charAt(0).toUpperCase() + browser!.slice(1)
}

export function ready(browser: DevOptions['browser']): string {
  return (
    `${getLoggingPrefix('success')} ` +
    `Running ${capitalizedBrowserName(browser)} in ${magenta('production')} mode. ` +
    `Browser extension enabled...`
  )
}

export function building(browser: DevOptions['browser']): string {
  return (
    `${getLoggingPrefix('info')} ` +
    `Building the extension package against ${capitalizedBrowserName(browser)}...`
  )
}

export function buildReady(): string {
  return 'No errors or warnings found. Your extension is ready for deployment.'
}

export function previewing(browser: DevOptions['browser']): string {
  return (
    `${getLoggingPrefix('info')} ` +
    `Previewing the extension on ${capitalizedBrowserName(browser)}...`
  )
}

function getLocales(projectPath: string, manifest: Record<string, any>) {
  const defaultLocale = manifest.default_locale as string

  // Get the list of all locale folders
  const localesDir = path.join(projectPath, '_locales')

  if (!fs.existsSync(localesDir)) {
    return {
      defaultLocale: 'EN',
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

export function getFileSize(fileSizeInBytes: number): string {
  return `${(fileSizeInBytes / 1024).toFixed(2)}KB`
}

export function getAssetsSize(assets: any[] | undefined) {
  let totalSize = 0
  assets?.forEach((asset) => {
    totalSize += asset.size
  })

  return getFileSize(totalSize)
}

function getDirectorySize(filepath: string): string {
  const fileSizeInBytes = calculateDirectorySize(filepath)
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const sizeType = Math.floor(Math.log(fileSizeInBytes) / Math.log(1024))
  const size = (fileSizeInBytes / Math.pow(1024, sizeType)).toFixed(1)

  return `${size} ${sizes[sizeType]}`
}

export function printTree(node: Record<string, any>, prefix = ''): string {
  let output = ''

  Object.keys(node).forEach((key, index, array) => {
    const isLast = index === array.length - 1
    const connector = isLast ? '└─' : '├─'
    const sizeInKB = node[key].size
      ? ` (${getFileSize(node[key].size as number)})`
      : ''
    output += `${prefix}${connector} ${key}${sizeInKB}\n`
    if (typeof node[key] === 'object' && !node[key].size) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      output += printTree(node[key], `${prefix}${isLast ? '   ' : '|  '}`)
    }
  })

  return output
}
// • Filename: chrome_url_overrides/history.js, Size: 1.62KB
//   ▪ /Users/cezaraugusto/local/my-extensions/my-extension/chrome_url_overrides/history.js
// • Filename: chrome_url_overrides/history.css, Size: 1.23KB
//   ▪ /Users/cezaraugusto/local/my-extensions/my-extension/chrome_url_overrides/history.css
// • Filename: chrome_url_overrides/history.html, Size: 1.18KB
//   ▪ /Users/cezaraugusto/local/my-extensions/my-extension/chrome_url_overrides/history.html

export function getAssetInfo(
  outputPath: string,
  assets: Array<{name: string; size: number}> | undefined
): string {
  let output = '\n'
  assets?.forEach((asset) => {
    const sizeInKB = getFileSize(asset.size)
    output += `• ${'Filename:'} ${yellow(asset.name)}, ${'Size:'} ${sizeInKB}\n`
    output += `  ${'└─'} ${underline(`${path.join(outputPath, asset.name)}`)}\n`
  })
  return output
}

export function getAssetsTree(assets: StatsAsset[] | undefined): string {
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

export function buildWebpack(
  projectDir: string,
  stats: any,
  browser: DevOptions['browser']
): string {
  // Convert stats object to JSON format
  const statsJson = stats?.toJson()
  const manifestPath = path.join(projectDir, 'manifest.json')
  const manifest: Record<string, string> = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8')
  )
  const assets: any[] = statsJson?.assets
  const heading = `${getLoggingPrefix('info')} Building ${
    manifest.name
  } extension using ${browser} defaults...\n`
  const buildTime = `\nBuild completed in ${(
    (statsJson?.time || 0) / 1000
  ).toFixed(2)} seconds.\n`
  const buildTarget = `Build Target: ${capitalizedBrowserName(browser)}\n`
  const buildStatus = `Build Status: ${
    stats?.hasErrors() ? red('Failed') : green('Success')
  }\n`
  const version = `Version: ${manifest.version}\n`
  const size = `Size: ${getAssetsSize(assets)}\n`

  let output = ''
  output += heading
  output += getAssetsTree(assets)
  // output += getAssetInfo(outputPath, assets)
  output += version
  output += size
  output += buildTime
  output += buildTarget
  output += buildStatus

  return output
}

export function writingTypeDefinitions(manifest: Manifest) {
  return (
    `${getLoggingPrefix('info')} ${manifest.name} (v${manifest.version}) ` +
    `has no type definitions. Writing...`
  )
}

export function downloadingText(url: string) {
  return `${getLoggingPrefix('success')} Downloading extension from ${url}...`
}

export function unpackagingExtension(zipFilePath: string) {
  return `${getLoggingPrefix('success')} Unpackaging browser extension from ${underline(zipFilePath)}`
}

export function unpackagedSuccessfully() {
  return `${getLoggingPrefix('success')} Browser extension unpackaged successfully. Compiling...`
}

export function failedToDownloadOrExtractZIPFile(error: any) {
  return `${getLoggingPrefix('error')} Failed to download or extract ZIP file: ${error}`
}

export function writeTypeDefinitionsError(error: any) {
  return '🔴 - Failed to write the extension type definition. ' + error
}

export function noGitIgnoreFound(projectDir: string) {
  return (
    `${getLoggingPrefix('success')} ` +
    `No ${yellow('.gitignore')} found, zipping all the content ` +
    `inside ${underline(projectDir)}`
  )
}

export function packagingSourceFiles(zipPath: string) {
  return (
    `\n${getLoggingPrefix('success')}` +
    `Packaging source files to ${underline(zipPath)}. ` +
    `Files in ${yellow('.gitignore')} will be excluded...`
  )
}

export function packagingDistributionFiles(zipPath: string) {
  return (
    `\n${getLoggingPrefix('success')} ` +
    `Packaging extension distribution files to ${underline(zipPath)}...`
  )
}

export function treeWithSourceAndDistFiles(
  browser: string,
  name: string,
  sourceZip: string,
  destZip: string
) {
  return (
    `\n${'📦 Package name:'} ${yellow(
      `${name}`
    )}, ${'Target Browser:'} ${`${browser}`}` +
    `\n   ${'└─'} ${underline(`${sourceZip}`)} (source)` +
    `\n   ${'└─'} ${underline(`${destZip}`)} (distribution)`
  )
}

export function treeWithDistFilesbrowser(
  name: string,
  ext: string,
  browser: string,
  zipPath: string
) {
  return (
    `\n${'📦 Package name:'} ${yellow(`${name}.${ext}`)}, ` +
    `${'Target Browser:'} ${`${browser}`}` +
    `\n   ${'└─'} ${underline(`${zipPath}`)} (distribution)`
  )
}

export function treeWithSourceFiles(
  name: string,
  ext: string,
  browser: string,
  zipPath: string
) {
  return (
    `\n${'📦 Package name:'} ${yellow(`${name}-source.${ext}`)}, ` +
    `${'Target Browser:'} ${`${browser}`}` +
    `\n   ${'└─'} ${underline(`${zipPath}`)} (source)`
  )
}

export function failedToCompress(error: any) {
  return `${getLoggingPrefix('error')} Failed to compress extension package: ${error}`
}
