import path from 'path'
import fs from 'fs'
import {Stats, StatsAsset} from 'webpack'
import {type ErrorObject} from 'ajv'
import {
  red,
  yellow,
  green,
  underline,
  magenta,
  blue,
  cyan,
  bold
} from '@colors/colors/safe'
import {Manifest} from '../webpack-types'
import {StartOptions} from '../../commands/start'
import {DevOptions} from '../../commands/dev'

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

export function boring(
  stats: Stats,
  manifestName: string | undefined,
  manifestVersion: string | undefined
) {
  const divider = stats.hasErrors() ? 'error' : 'success'

  return `${getLoggingPrefix(divider)} ${manifestName} (v${manifestVersion})`
}

export function serverRestartRequiredFromHtml(
  projectPath: string,
  filePath: string
) {
  const basename = path.relative(projectPath, filePath)
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
  return `manifest.json: ${errorMessage}`
}

export function manifestFieldRequiredError(requiredField: string) {
  const hintMessage = `Update your manifest.json file to run your extension.`
  const errorMessage = `Field \`${requiredField}\` is required. ${hintMessage}`

  return `manifest.json: ${errorMessage}`
}

export function manifestFieldError(feature: string, filePath: string) {
  const featureName = feature.startsWith('content_scripts')
    ? `content_scripts`
    : feature.replace('/', '.')
  const hintMessage =
    `Check the ${underline(featureName)} ` +
    (featureName === 'content_scripts'
      ? `(index ${feature.split('-')[1]}) `
      : '') +
    `field in your manifest.json file.`
  const pagesMessage = `Check the ${underline(
    'pages'
  )} folder in your project root directory.`
  const isPage = feature.startsWith('pages')
  const errorMessage = `manifest.json ${red('✖︎✖︎✖︎')} File not found. ${
    isPage ? pagesMessage : hintMessage
  }\n\n${red('(not found)')} ${underline(filePath)}`

  return `${errorMessage}`
}

export function javaScriptError(
  manifestPath: string,
  filePath: string,
  inputFilepath: string
) {
  const pathRelative = path.relative(manifestPath, filePath)
  const hintMessage = `Check your <script> tags in \`${filePath}\`.`
  const errorMessage = `File not found\n- \`${inputFilepath}\` (not found)\n\n${hintMessage}`
  return `[${pathRelative}] ${errorMessage}`
}

export function cssError(
  manifestPath: string,
  filePath: string,
  inputFilepath: string
) {
  const pathRelative = path.relative(manifestPath, filePath)
  const hintMessage = `Check your <link> tags in \`${filePath}\`.`
  const errorMessage = `File not found\n- \`${inputFilepath}\` (not found)\n\n${hintMessage}`
  return `[${pathRelative}] ${errorMessage}`
}

export function staticAssetErrorMessage(
  manifestPath: string,
  filePath: string,
  inputFilepath: string
) {
  const extname = path.extname(inputFilepath)
  const pathRelative = path.relative(manifestPath, filePath)
  const hintMessage = `Check your *${extname} assets in \`${filePath}\`.`
  const errorMessage = `File not found\n- \`${inputFilepath}\` (not found)\n${hintMessage}`
  return `[${pathRelative}] ${errorMessage}`
}

export function entryNotFoundWarn(feature: string, filePath: string) {
  const hintMessage = `Check the \`${feature}\` field in your \`manifest.json\` file.`
  const errorMessage = `File not found:\n- ${filePath}.\n${hintMessage}`
  return `${getLoggingPrefix('error')} ${errorMessage}`
}

export function serverRestartRequiredFromManifest() {
  const errorMessage =
    `manifest.json ${red('✖︎✖︎✖︎')} Changing the path of non-static ` +
    `fields during development requires a server restart.`

  return errorMessage
}

export function manifestNotFoundError() {
  const hintMessage = `Ensure you have a manifest.json file at the root direcotry of your project.`
  const errorMessage = `manifest.json A manifest file is required. ${hintMessage}`

  return errorMessage
}

export function manifestInvalidError(error: NodeJS.ErrnoException) {
  const hintMessage = `Update your manifest file and try again.`
  const errorMessage = `manifest.json ${error}. ${hintMessage}`

  return errorMessage
}

export function pathNotFoundError() {
  return `Could not resolve file path. Ensure the file exists in the "public" or "pages" directory.`
}

export function resolverHtmlError(filePath: string) {
  return `Could not resolve path ${filePath}. Either add it to the "public" directory or create a page in the "pages" directory.`
}

export function resolverJsError(filePath: string) {
  return `Could not resolve path ${filePath}. Either add it to the "public" directory or create a script in the "scripts" directory.`
}

export function resolverStaticError(filePath: string) {
  return `Could not resolve path ${filePath}. If you want to preserve this file path, add the file to the "public" directory.`
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
    `${getLoggingPrefix('error')} ` +
    `Manifest file not found. Ensure the path to your extension exists and try again.`
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

  const projectPath = path.dirname(manifestPath)

  switch (path.extname(filePath)) {
    case '.js':
    case '.ts':
    case '.jsx':
    case '.tsx':
      return javaScriptError(projectPath, feature, filePath)
    case '.css':
    case '.scss':
    case '.sass':
    case '.less':
      return cssError(projectPath, feature, filePath)
    default:
      return staticAssetErrorMessage(projectPath, feature, filePath)
  }
}

export function startWebpack(
  projectPath: string,
  options: StartOptions
): string {
  const outputPath = path.join(projectPath, 'dist', options.browser || 'chrome')
  const manifestPath = path.join(outputPath, 'manifest.json')
  const manifest: Record<string, any> = require(manifestPath)

  const {name, description, version, hostPermissions, permissions} = manifest

  const defaultLocale = getLocales(projectPath, manifest).defaultLocale
  const otherLocales = getLocales(projectPath, manifest).otherLocales.join(', ')
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
export function capitalizedBrowserName(browser: DevOptions['browser']) {
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
  projectPath: string,
  stats: any,
  outputPath: string,
  browser: string
): string {
  // Convert stats object to JSON format
  const statsJson = stats?.toJson()
  const manifestPath = path.join(projectPath, 'manifest.json')
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

export function serverRestartRequiredFromWebpack(
  addingOrRemoving: string,
  addedOrRemoved: string,
  folder: string,
  typeOfAsset: string,
  pathRelative: string
) {
  return (
    `${getLoggingPrefix('info')} Entry Point Modification Found\n\n` +
    `${addingOrRemoving} ${typeOfAsset} in the ${underline(
      folder + '/'
    )} folder after compilation requires a server restart.\n` +
    `\n\n- File ${addedOrRemoved}: ${underline(pathRelative)}\n\n` +
    `To apply these changes, restart the program.`
  )
}

export function featureNotInstalled(feature: string, packageManeger: string) {
  return (
    `${getLoggingPrefix('info')} ` +
    `Installing ${yellow(feature)} required dependencies via ${blue(
      packageManeger
    )}. ` +
    `This is a one time operation...`
  )
}

export function installingRootDependencies() {
  return (
    `${getLoggingPrefix('info')} ` +
    'Installing dependencies in the project root. This is only happens for authors and contributors...'
  )
}

export function featureInstalledSuccessfully(feature: string) {
  return (
    `${getLoggingPrefix('success')} ` +
    `${feature} and related dependencies installed successfully...`
  )
}

export function youAreAllSet(feature: string) {
  return (
    `${getLoggingPrefix('success')} ` +
    `You are all set! Run the program again to start hacking, now with ${cyan(
      feature
    )} support.`
  )
}

export function failedToinstallFeature(error: unknown) {
  return (
    `${getLoggingPrefix('error')} ` +
    'Failed to detect package manager or install packages: ' +
    error?.toString()
  )
}

export function creatingTSConfig(manifest: Manifest) {
  return isUsingTechnology(manifest, 'TypesScript').replace(
    '.',
    `but no config file was found. Creating ${yellow('tsconfig.json')}...`
  )
}

export function writingTypeDefinitions(manifest: Manifest) {
  return (
    `${getLoggingPrefix('info')} ${manifest.name} (v${manifest.version}) ` +
    `has no type definitions. Writing...`
  )
}

export function backgroundIsRequred(feature: string, filePath: string) {
  const hintMessage = `Check the ${underline(
    feature.replace('/', '.')
  )} field in your manifest.json file.`
  return (
    `\n\n${`${bold(red('ERROR'))} in manifest.json ${red('✖✖✖')}`} ` +
    `File not found. ${hintMessage}\n\n${red('(not found)')} ${underline(filePath)}\n`
  )
}

export function firefoxServiceWorkerError() {
  return (
    `${getLoggingPrefix('error')}` +
    `Firefox does not support the ${underline('background.service_worker')} field yet.\n` +
    `See ${underline('https://bugzilla.mozilla.org/show_bug.cgi?id=1573659')}.\n\n` +
    `Update your manifest.json file to use ${underline('background.scripts')} instead.`
  )
}

export function insecurePolicy() {
  return (
    `manifest.json: Insecure ${yellow('content-security-policy')} value " ` +
    `'${yellow('unsafe-eval')}'" in directive '${blue('script-src')}'.`
  )
}

export function getManifestDocumentationURL(browser: string) {
  const isChrome = browser === 'chrome'
  const chromeUrl =
    'https://developer.chrome.com/docs/extensions/reference/manifest'
  const mdnUrl = `https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json`

  return isChrome ? blue(underline(chromeUrl)) : blue(underline(mdnUrl || ''))
}

export function webAccessibleResourcesV2Type(browser: string) {
  return `manifest.json: ${underline(
    'web_accessible_resources'
  )} must be a string array in Manifest version 2.
    
    Read more about using ${underline(
      'web_accessible_resources'
    )} in the manifest file:
    ${getManifestDocumentationURL(browser)}`
}

export function webAccessibleResourcesV3Type(browser: string) {
  return (
    `manifest.json: ${underline('web_accessible_resources')} must be an array of ` +
    `objects in Manifest version 3.\n\n` +
    `Read more about using ${underline('web_accessible_resources')} in the manifest file: ` +
    `${getManifestDocumentationURL(browser)}`
  )
}

export function deprecatedMessage(
  browser: string,
  errorData: ErrorObject<string, Record<string, any>, unknown> | undefined
) {
  const schemaPath = errorData?.schemaPath
  const splitSchemaPath = schemaPath?.split('/')
  const field = splitSchemaPath?.slice(splitSchemaPath.length - 2).shift()
  const namespace = yellow(field?.split('.')[0] || '')

  return (
    `Field ${yellow(field || '')} is deprecated in Manifest V3. ` +
    `Update your manifest.json file to run your extension.\n\n` +
    `Read more about using ${namespace} in the manifest file: ` +
    `${getManifestDocumentationURL(browser)}`
  )
}

export function handleMultipleAssetsError(
  manifestName: string,
  filename: string
) {
  const extFilename = filename.split('.').pop()
  const errorMsg =
    `content_scripts: One of your ${extFilename?.toUpperCase()} ` +
    `imports is also a content_script CSS in manifest.json.\n\n` +
    `Remove the duplicate entry and try again.`

  if (filename.startsWith('content_scripts')) {
    return errorMsg
  }
}

export function missingRequiredMessage(
  browser: string,
  message: string | undefined
) {
  const hintMessage = `Update your manifest.json file to run your extension.`
  const namespace = yellow(message?.split('.')[0] || '')
  const errorMessage = `Field ${yellow(message || '')} is required. ${hintMessage}

Read more about using ${namespace} in the manifest file:
${getManifestDocumentationURL(browser)}`
  return errorMessage
}

export function invalidFieldType(
  errorData: ErrorObject | undefined,
  browser: string
) {
  const field = errorData?.instancePath.replaceAll('/', '.').slice(1) || ''
  const type: string = errorData?.params.type
  const namespace = yellow(field?.split('.')[0] || '')

  return `Field ${yellow(field)} must be of type ${cyan(type)}.

Read more about using ${namespace} in the manifest file:
${getManifestDocumentationURL(browser)}`
}

export function handleCantResolveError(
  manifestName: string,
  moduleName: string
) {
  const link = 'https://extension.js.org/n/development/special-folders'
  return (
    `${manifestName} ${red('✖︎✖︎✖︎')} Module ${yellow(moduleName)} not found.\n` +
    `Make sure file exists in the extension directory.\n\n` +
    `If you need to handle entries not supported by manifest.json, ` +
    `consider adding them to a special folder.` +
    `\n\nRead more: ${underline(link)}.`
  )
}

export function handleTopLevelAwaitError(manifestName: string) {
  const topLevelAwaitMsg =
    'Top-level-await is only supported in EcmaScript Modules'

  const additionalInfo =
    'Make sure to set the module type to "module" in your package.json or ' +
    'use the .mjs extension for your files.'

  return `${manifestName} ${red('✖︎✖︎✖︎')} ${topLevelAwaitMsg + '.\n' + additionalInfo}`
}

export function fetchingProjectPath(owner: string, project: string) {
  return `${getLoggingPrefix('success')} Fetching data from ${underline(`https://github.com/${owner}/${project}`)}`
}

export function downloadingProjectPath(projectName: string) {
  return `${getLoggingPrefix('success')} Downloading ${projectName}...`
}

export function creatingProjectPath(projectName: string) {
  return `${getLoggingPrefix('success')} Creating a new browser extension in ${underline(`${process.cwd()}/${projectName}`)}`
}

export function envFileLoaded(manifestName: string, manifestVersion: string) {
  return `${getLoggingPrefix('info')} ` + `${yellow('env')} file loaded.`
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

export function failedToDownloadOrExtractZIPFile(error: string) {
  return `${getLoggingPrefix('error')} Failed to download or extract ZIP file: ${error}`
}

export function noGitIgnoreFound(projectPath: string) {
  return (
    `${getLoggingPrefix('success')} ` +
    `No ${yellow('.gitignore')} found, zipping all the content ` +
    `inside ${underline(projectPath)}`
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
