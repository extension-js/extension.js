import * as fs from 'fs'
import * as path from 'path'
import {StatsAsset} from '@rspack/core'
import colors from 'pintor'
import {Manifest} from '../webpack/webpack-types'
import {type DevOptions} from '../types/options'
import packageJson from '../package.json'

// Prefix candidates (try swapping if desired): '►', '›', '→', '—'
function getLoggingPrefix(type: 'warn' | 'info' | 'error' | 'success'): string {
  if (type === 'error') return colors.red('ERROR')
  if (type === 'warn') return colors.brightYellow('►►►')
  if (type === 'info') return colors.gray('►►►')
  return colors.green('►►►')
}

function isPathLike(input: string) {
  return input.includes('/') || input.includes('\\') || path.isAbsolute(input)
}

export function manifestNotFoundError(manifestPath: string) {
  return (
    `${getLoggingPrefix('error')} Manifest file not found.\n` +
    `${colors.red('Ensure the path to your extension exists and try again.')}` +
    `\n${colors.red('NOT FOUND')}\n${colors.gray('PATH')} ${colors.underline(manifestPath)}`
  )
}

export function packageJsonNotFoundError(manifestPath: string) {
  return (
    `${getLoggingPrefix('error')} No valid package.json found for manifest.\n` +
    `${colors.red('Ensure there is a valid package.json file in the project or its parent directories.')}` +
    `\n${colors.red('MANIFEST')}\n${colors.gray('PATH')} ${colors.underline(manifestPath)}`
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

export function runningInProduction(outputPath: string): string {
  const manifestPath = path.join(outputPath, 'manifest.json')
  const manifest: Record<string, any> = JSON.parse(
    fs.readFileSync(manifestPath, 'utf-8')
  )

  const {name, version, hostPermissions, permissions} = manifest

  const hasHost = hostPermissions && hostPermissions.length
  const hasPermissions = permissions && permissions.length

  return `${` 🧩 ${colors.brightBlue('Extension.js')} ${colors.gray(`${packageJson.version}`)}`}
${`    Extension Name        `} ${colors.gray(name)}
${`    Extension Version     `} ${colors.gray(version)}
${`    Host Permissions      `} ${colors.gray(
    hasHost ? hostPermissions.join(', ') : 'Browser defaults'
  )}
${`    Permissions           `} ${colors.gray(
    hasPermissions ? permissions.join(', ') : 'Browser defaults'
  )}
`
}

export function previewing(browser: DevOptions['browser']) {
  return `${getLoggingPrefix('info')} Previewing the extension on ${capitalizedBrowserName(browser)}...`
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
  const heading = `${getLoggingPrefix('info')} Building ${colors.blue(
    manifest.name
  )} extension using ${capitalizedBrowserName(browser)} defaults...\n`
  const buildTime = `\nBuild completed in ${(
    (statsJson?.time || 0) / 1000
  ).toFixed(2)} seconds.`
  const buildTarget = `Build Target: ${colors.gray(capitalizedBrowserName(browser))}\n`
  const buildStatus = `Build Status: ${
    stats?.hasErrors() ? colors.red('Failed') : colors.green('Success')
  }\n`
  const version = `\nVersion: ${colors.gray(manifest.version)}\n`
  const size = `Size: ${colors.gray(getAssetsSize(assets))}\n`

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
  )} No errors or warnings found. Your extension is ${colors.green(
    'ready for deployment'
  )}.`
}

export function fetchingProjectPath(owner: string, project: string) {
  return (
    `${getLoggingPrefix('info')} Fetching data...\n` +
    `${colors.gray('URL')} ${colors.underline(`https://github.com/${owner}/${project}`)}`
  )
}

export function downloadingProjectPath(projectName: string) {
  const formatted = isPathLike(projectName)
    ? colors.underline(projectName)
    : colors.yellow(projectName)
  return `${getLoggingPrefix('info')} Downloading ${formatted}...`
}

export function creatingProjectPath(projectPath: string) {
  return (
    `${getLoggingPrefix('info')} Creating a new browser extension...\n` +
    `${colors.gray('PATH')} ${colors.underline(projectPath)}`
  )
}

export function downloadedProjectFolderNotFound(
  cwd: string,
  candidates: string[]
) {
  return (
    `${getLoggingPrefix('error')} Downloaded project folder not found.\n` +
    `${colors.gray('PATH')} ${colors.underline(cwd)}\n` +
    `${colors.gray('Tried')} ${colors.underline(candidates.join(', '))}`
  )
}

export function noGitIgnoreFound(projectDir: string) {
  return (
    `${getLoggingPrefix('info')} No ${colors.yellow('.gitignore')} found, ` +
    `zipping all the content inside path:\n` +
    `${colors.gray('PATH')} ${colors.underline(projectDir)}`
  )
}

export function packagingSourceFiles(zipPath: string) {
  return (
    `${getLoggingPrefix('info')} Packaging source files. ` +
    `Files in ${colors.yellow('.gitignore')} will be excluded...\n` +
    `${colors.gray('PATH')} ${colors.underline(zipPath)}.`
  )
}

export function packagingDistributionFiles(zipPath: string) {
  return (
    `${getLoggingPrefix('info')} Packaging extension distribution files...\n` +
    `${colors.gray('PATH')} ${colors.underline(zipPath)}`
  )
}

export function treeWithSourceAndDistFiles(
  browser: DevOptions['browser'],
  name: string,
  sourceZip: string,
  destZip: string
) {
  return (
    `${'📦 Package name:'} ${colors.blue(
      `${name}`
    )}, ${'Target Browser:'} ${`${capitalizedBrowserName(browser)}`}` +
    `\n   ${colors.gray('└─')} ${colors.underline(`${sourceZip}`)} ${colors.gray('(source)')}` +
    `\n   ${colors.gray('└─')} ${colors.underline(`${destZip}`)} ${colors.gray('(distribution)')}`
  )
}

export function treeWithDistFilesbrowser(
  name: string,
  ext: string,
  browser: DevOptions['browser'],
  zipPath: string
) {
  return (
    `${'📦 Package name:'} ${colors.blue(`${name}.${ext}`)}, ` +
    `${'Target Browser:'} ${`${capitalizedBrowserName(browser)}`}` +
    `\n   ${colors.gray('└─')} ${colors.underline(`${zipPath}`)} ${colors.gray('(distribution)')}`
  )
}

export function treeWithSourceFiles(
  name: string,
  ext: string,
  browser: DevOptions['browser'],
  zipPath: string
) {
  return (
    `${'📦 Package name:'} ${colors.blue(`${name}-source.${ext}`)}, ` +
    `${'Target Browser:'} ${`${capitalizedBrowserName(browser)}`}` +
    `\n   ${colors.gray('└─')} ${colors.underline(`${zipPath}`)} ${colors.gray('(source)')}`
  )
}

export function failedToCompressError(error: any) {
  return `${getLoggingPrefix(
    'error'
  )} Failed to compress extension package.\n${colors.red(error)}`
}

export function writingTypeDefinitions(manifest: Manifest) {
  return (
    `${getLoggingPrefix('info')} ` +
    `Writing type definitions for ${colors.blue(manifest.name || '')}...`
  )
}

export function writingTypeDefinitionsError(error: any) {
  return `${getLoggingPrefix(
    'error'
  )} Failed to write the extension type definition.\n${colors.red(error)}`
}

export function downloadingText(url: string) {
  return (
    `${getLoggingPrefix('info')} Downloading browser extension...\n` +
    `${colors.gray('URL')} ${colors.underline(url)}`
  )
}

export function unpackagingExtension(zipFilePath: string) {
  return (
    `${getLoggingPrefix('info')} Unpackaging browser extension...\n` +
    `${colors.gray('PATH')} ${colors.underline(zipFilePath)}`
  )
}

export function unpackagedSuccessfully() {
  return `${getLoggingPrefix(
    'info'
  )} Browser extension unpackaged ${colors.green('successfully')}.`
}

export function failedToDownloadOrExtractZIPFileError(error: any) {
  return (
    `${getLoggingPrefix('error')} ` +
    `Failed to download or extract ZIP file.\n${colors.red(error)}`
  )
}

export function invalidRemoteZip(url: string, contentType: string) {
  return (
    `${getLoggingPrefix('error')} ` +
    `Remote URL does not appear to be a ZIP archive.\n` +
    `${colors.gray('URL')} ${colors.underline(url)}\n` +
    `${colors.gray('Content-Type')} ${colors.underline(contentType || 'unknown')}`
  )
}

function capitalizedBrowserName(browser: DevOptions['browser']) {
  const b = String(browser || '')
  const cap = b.charAt(0).toUpperCase() + b.slice(1)
  return colors.yellow(`${cap}`)
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

function printTree(node: Record<string, any>, prefix = ''): string {
  let output = ''

  Object.keys(node).forEach((key, index, array) => {
    const isLast = index === array.length - 1
    const connector = isLast ? '└─' : '├─'
    const sizeInKB = node[key].size
      ? ` (${getFileSize(node[key].size as number)})`
      : ''
    output += `${colors.gray(prefix)}${colors.gray(connector)} ${key}${colors.gray(sizeInKB)}\n`
    if (typeof node[key] === 'object' && !node[key].size) {
      output += printTree(
        node[key],
        `${prefix}${isLast ? '   ' : colors.gray('│  ')}`
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
  return `${getLoggingPrefix('info')} Using ${colors.yellow(integration)}.`
}

export function installingDependencies() {
  return `${getLoggingPrefix('info')} Installing project dependencies...`
}

export function installingDependenciesFailed(
  gitCommand: string,
  gitArgs: string[],
  code: number | null
) {
  return `${getLoggingPrefix('error')} Command ${colors.gray(gitCommand)} ${colors.gray(gitArgs.join(' '))} failed.\n${colors.red(`exit code ${colors.gray(String(code))}`)}`
}

export function installingDependenciesProcessError(error: any) {
  return `${getLoggingPrefix('error')} Child process error: Can't install project dependencies.\n${colors.red(String(error))}`
}

export function cantInstallDependencies(error: any) {
  return `${getLoggingPrefix('error')} Can't install project dependencies.\n${colors.red(String(error?.message || error))}`
}

export function portInUse(requestedPort: number, newPort: number) {
  return `${getLoggingPrefix('warn')} Port ${colors.gray(requestedPort.toString())} is in use. Using port ${colors.gray(newPort.toString())} instead.`
}

export function configLoadingError(configPath: string, error: unknown) {
  return `${getLoggingPrefix('error')} Failed to load ${colors.underline(configPath)} config.\n${colors.red(String(error))}`
}

export function managedDependencyConflict(
  duplicates: string[],
  userPackageJsonPath: string
) {
  const list = duplicates.map((d) => `- ${colors.yellow(d)}`).join('\n')
  return (
    `${getLoggingPrefix('error')} Your project declares dependencies that are managed by ${colors.blue('Extension.js')} and referenced in ${colors.underline('extension.config.js')}\n` +
    `${colors.red('This can cause version conflicts and break the development/build process.')}\n\n` +
    `${colors.gray('Managed dependencies (remove these from your package.json):')}\n` +
    `${list}\n\n` +
    `${colors.gray('PATH')} ${colors.underline(userPackageJsonPath)}\n` +
    `If you need a different version, open an issue so we can consider bundling it safely.\n` +
    `Operation aborted.`
  )
}

// Auto-exit helpers used by dev server for non-interactive runs
export function autoExitModeEnabled(autoExitMs: number) {
  return `${getLoggingPrefix('info')} Auto-exit enabled. Exiting after ${colors.gray(`${autoExitMs}ms`)}.`
}

export function autoExitTriggered(autoExitMs: number) {
  return `${getLoggingPrefix('info')} Auto-exit timer elapsed (${colors.gray(`${autoExitMs}ms`)}) – cleaning up...`
}

export function autoExitForceKill(forceKillMs: number) {
  return `${getLoggingPrefix('warn')} Force-killing process after fallback (${colors.gray(`${forceKillMs}ms`)})`
}

export function isUsingCustomLoader(loaderPath: string) {
  return `${getLoggingPrefix('info')} Using custom loader: ${colors.yellow(loaderPath)}.`
}
