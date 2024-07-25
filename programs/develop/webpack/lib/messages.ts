import path from 'path'
import fs from 'fs'
import {StatsAsset} from 'webpack'
import {
  bgWhite,
  red,
  yellow,
  green,
  underline,
  magenta,
  blue,
  cyan
} from '@colors/colors/safe'
import {Manifest} from '../types'
import {StartOptions} from '../../develop-types'

// Utility function for logging prefixes
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

export function serverRestartRequiredFromHtml(
  projectDir: string,
  filePath: string
) {
  const basename = path.relative(projectDir, filePath)
  const errorMessage = `[${basename}] Entry Point Modification Found

Changing <script> or <link rel="stylesheet"> source paths after compilation requires a server restart. Restart the program and try again.`

  return errorMessage
}

export function reloadAfterErrorRequiredMessage() {
  const hintMessage = `and run the program again.`
  const errorMessage = `Ensure \`<script>\` sources are valid ${hintMessage}`

  return errorMessage
}

export function manifestMissingError() {
  const hintMessage = `A manifest file is required for this plugin to run.`
  const errorMessage = `File \`manifest.json\` not found. ${hintMessage}`
  return `[manifest.json]: ${errorMessage}`
}

export function manifestFieldRequiredError(requiredField: string) {
  const hintMessage = `Update your manifest.json file to run your extension.`
  const errorMessage = `Field \`${requiredField}\` is required. ${hintMessage}`

  return `[manifest.json]: ${errorMessage}`
}

export function manifestFieldError(feature: string, htmlFilePath: string) {
  const hintMessage = `Check the ${feature} field in your manifest.json file.`
  const pagesMessage = `Check the \`pages\` folder in your project root directory.`
  const isPage = feature.startsWith('pages')
  const errorMessage = `File path \`${htmlFilePath}\` not found. ${
    isPage ? pagesMessage : hintMessage
  }`
  return `[manifest.json]: ${errorMessage}`
}

export function javaScriptError(
  manifestPath: string,
  htmlFilePath: string,
  inputFilepath: string
) {
  const pathRelative = path.relative(manifestPath, htmlFilePath)
  const hintMessage = `Check your <script> tags in \`${htmlFilePath}\`.`
  const errorMessage = `File not found\n- \`${inputFilepath}\` (not found)\n\n${hintMessage}`
  return `[${pathRelative}] ${errorMessage}`
}

export function cssError(
  manifestPath: string,
  htmlFilePath: string,
  inputFilepath: string
) {
  const pathRelative = path.relative(manifestPath, htmlFilePath)
  const hintMessage = `Check your <link> tags in \`${htmlFilePath}\`.`
  const errorMessage = `File not found\n- \`${inputFilepath}\` (not found)\n\n${hintMessage}`
  return `[${pathRelative}] ${errorMessage}`
}

export function staticAssetErrorMessage(
  manifestPath: string,
  htmlFilePath: string,
  inputFilepath: string
) {
  const extname = path.extname(inputFilepath)
  const pathRelative = path.relative(manifestPath, htmlFilePath)
  const hintMessage = `Check your *${extname} assets in \`${htmlFilePath}\`.`
  const errorMessage = `File not found\n- \`${inputFilepath}\` (not found)\n${hintMessage}`
  return `[${pathRelative}] ${errorMessage}`
}

export function entryNotFoundWarn(feature: string, iconFilePath: string) {
  const hintMessage = `Check the \`${feature}\` field in your \`manifest.json\` file.`
  const errorMessage = `File path \`${iconFilePath}\` not found. ${hintMessage}`
  return `[manifest.json]: ${errorMessage}`
}

export function serverRestartRequiredFromManifest() {
  const errorMessage =
    `[manifest.json] Entry Point Modification Found.\n` +
    `Changing the path of non-static assets defined in manifest.json` +
    `requires a server restart. To apply these changes, restart ` +
    `the program and try again.`

  return errorMessage
}

export function manifestNotFoundError() {
  const hintMessage = `Ensure you have a manifest.json file at the root direcotry of your project.`
  const errorMessage = `[manifest.json] A manifest file is required. ${hintMessage}`

  return errorMessage
}

export function manifestInvalidError(error: NodeJS.ErrnoException) {
  const hintMessage = `Update your manifest file and run the program again.`
  const errorMessage = `[manifest.json] ${error}. ${hintMessage}`

  return errorMessage
}

export function calculateDirectorySize(dirPath: string): number {
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

export function manifestNotFound() {
  return (
    `${"Error! Can't find the project's manifest file."}` +
    `Check your extension ${yellow('manifest.json')} ` +
    `file and ensure its path points to one of the options above, and try again.`
  )
}

export function browserNotFound(chromePath: string) {
  return (
    `${bgWhite(` chrome-browser `)} ` +
    `${red('✖︎✖︎✖︎')} Chrome not found at ${chromePath}`
  )
}

export function webSocketError(error: NodeJS.ErrnoException) {
  return (
    `[⛔️] ${bgWhite(` chrome-browser `)} ` +
    `${red('✖︎✖︎✖︎')} WebSocket error ${error}`
  )
}

export function parseFileError(error: NodeJS.ErrnoException, filepath: string) {
  return (
    `[⛔️] ${bgWhite(` chrome-browser `)} ${red('✖︎✖︎✖︎')} ` +
    `Error parsing file: ${filepath}. Reason: ${error.message}`
  )
}

export function fileNotFound(
  manifestPath: string,
  feature: string | undefined,
  filePath: string
) {
  if (!feature) {
    throw new Error('This operation is impossible. Please report a bug.')
  }

  const projectDir = path.dirname(manifestPath)

  switch (path.extname(filePath)) {
    case '.js':
    case '.ts':
    case '.jsx':
    case '.tsx':
      return javaScriptError(projectDir, feature, filePath)
    case '.css':
    case '.scss':
    case '.sass':
    case '.less':
      return cssError(projectDir, feature, filePath)
    default:
      return staticAssetErrorMessage(projectDir, feature, filePath)
  }
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

export function ready(options: StartOptions): string {
  const capitalizedBrowserName =
    options.browser!.charAt(0).toUpperCase() + options.browser!.slice(1)

  return (
    `${getLoggingPrefix('success')} ` +
    `Running ${capitalizedBrowserName} in ${magenta(
      'production'
    )} mode. Browser extension ${'enabled'}...`
  )
}

export function building(options: StartOptions): string {
  const capitalizedBrowserName =
    options.browser!.charAt(0).toUpperCase() + options.browser!.slice(1)

  return (
    `${getLoggingPrefix('info')} ` +
    `Building the extension package against ${capitalizedBrowserName}...`
  )
}

export function previewing(options: StartOptions): string {
  const capitalizedBrowserName =
    options.browser!.charAt(0).toUpperCase() + options.browser!.slice(1)

  return (
    `${getLoggingPrefix('info')} ` +
    `Previewing the extension on ${capitalizedBrowserName}...`
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

export default function getDirectorySize(filepath: string): string {
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
  outputPath: string,
  browser: string
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
  ).toFixed(2)} seconds.`
  const buildStatus = `Build Status: ${
    stats?.hasErrors() ? red('Failed') : green('Success')
  }`
  const version = `Version: ${manifest.version}`
  const size = `Size: ${getAssetsSize(assets)}`

  let output = ''
  output += heading
  output += getAssetsTree(assets)
  output += getAssetInfo(outputPath, assets)
  output += buildTime
  output += buildStatus
  output += version
  output += size

  return output
}

export function buildReady() {
  return green(
    '\nNo errors or warnings found. Your extension is ready for deployment.'
  )
}

export function errorWhileBuilding(error: any) {
  return (
    `${getLoggingPrefix('error')} ` +
    `Error while building the extension:\n\n${red((error as string) || '')}`
  )
}

export function errorWhilePreviewing(error: any) {
  return (
    `${getLoggingPrefix('error')} ` +
    `Error while previewing the extension:\n\n${red((error as string) || '')}`
  )
}
export function errorWhileStarting(error: any) {
  return (
    `${getLoggingPrefix('error')} ` +
    `Error while starting the extension:\n\n${red((error as string) || '')}`
  )
}

export function errorWhileDeveloping(error: any) {
  return (
    `${getLoggingPrefix('error')} ` +
    `Error while developing the extension:\n\n${red((error as string) || '')}`
  )
}

export function isUsingTechnology(manifest: Manifest, technology: any) {
  return (
    `${getLoggingPrefix('info')} ` +
    `${manifest.name} (v${manifest.version}) ` +
    `is using ${cyan(technology)}.`
  )
}

export function boring(stats: any) {
  const divider = stats.hasErrors() ? 'error' : 'success'

  return `${getLoggingPrefix(divider)}`
}

export function serverRestartRequiredFromWebpack(
  addingOrRemoving: string,
  addedOrRemoved: string,
  folder: string,
  typeOfAsset: string,
  pathRelative: string
) {
  return (
    `${getLoggingPrefix('info')} Entry Point Modification Found\n\n` +
    `${addingOrRemoving} ${typeOfAsset} in the ${underline(folder + '/')} folder after compilation requires a server restart.\n` +
    `\n\n- File ${addedOrRemoved}: ${underline(pathRelative)}\n\n` +
    `To apply these changes, restart the program.`
  )
}
