// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as fs from 'fs'
import * as path from 'path'
import {StatsAsset} from '@rspack/core'
import colors from 'pintor'
import type {Manifest, DevOptions} from '../webpack-types'
import packageJson from '../../package.json'

// Pretty-format helpers for human-readable, Vercel-like tone
export const fmt = {
  heading: (title: string) => colors.underline(colors.blue(title)),
  label: (key: string) => colors.gray(key.toUpperCase()),
  val: (value: string) => colors.underline(value),
  code: (value: string) => colors.blue(value),
  bullet: (value: string) => `- ${value}`,
  block(title: string, rows: Array<[string, string]>): string {
    const head = fmt.heading(title)
    const body = rows
      .map(([key, value]) => `${fmt.label(key)} ${value}`)
      .join('\n')
    return `${head}\n${body}`
  },
  truncate(input: unknown, max = 800): string {
    const s = (() => {
      try {
        return typeof input === 'string' ? input : JSON.stringify(input)
      } catch {
        return String(input)
      }
    })()
    return s.length > max ? s.slice(0, max) + '…' : s
  }
}

// Prefix candidates (try swapping if desired): '►', '›', '→', '—'
function getLoggingPrefix(type: 'warn' | 'info' | 'error' | 'success'): string {
  const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'

  if (isAuthor) {
    // Author mode: magenta, clearly branded, keeps three-element prefix shape
    const base = type === 'error' ? 'ERROR Author says' : '►►► Author says'
    return colors.brightMagenta(base)
  }

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

export function runningInProduction(
  outputPath: string,
  browserLabel?: string
): string {
  const manifestPath = path.join(outputPath, 'manifest.json')
  const manifest: Record<string, any> = JSON.parse(
    fs.readFileSync(manifestPath, 'utf-8')
  )

  const {name, version, hostPermissions, permissions} = manifest

  const hasHost = hostPermissions && hostPermissions.length
  const hasPermissions = permissions && permissions.length
  const browserDisplay =
    browserLabel && browserLabel.trim().length > 0
      ? browserLabel.trim()
      : 'Unknown'

  return (
    ` 🧩 ${colors.brightBlue('Extension.js')} ${colors.gray(`${packageJson.version}`)}\n` +
    `    Browser             ${colors.gray(browserDisplay)}\n` +
    `    Extension           ${colors.gray(
      version ? `${name} ${version}` : name
    )}\n` +
    `    Permissions         ${colors.gray(
      hasPermissions ? permissions.join(', ') : 'Browser defaults'
    )}\n` +
    `    Host Permissions    ${colors.gray(
      hasHost ? hostPermissions.join(', ') : 'Browser defaults'
    )}`
  )
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
  return fmt.block('Fetching project', [
    ['URL', fmt.val(`https://github.com/${owner}/${project}`)]
  ])
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
  return fmt.block('Downloading extension', [['URL', fmt.val(url)]])
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

// Development-only debug helpers
export function debugDirs(manifestDir: string, packageJsonDir: string) {
  return (
    `${getLoggingPrefix('info')} Directories\n` +
    `${colors.gray('MANIFEST_DIR')} ${colors.underline(manifestDir)}\n` +
    `${colors.gray('PACKAGE_JSON_DIR')} ${colors.underline(packageJsonDir)}`
  )
}

export function debugBrowser(
  browser: DevOptions['browser'],
  chromiumBinary?: string,
  geckoBinary?: string
) {
  return (
    `${getLoggingPrefix('info')} Browser Target\n` +
    `${colors.gray('BROWSER')} ${colors.yellow(String(browser))}\n` +
    `${colors.gray('CHROMIUM_BINARY')} ${colors.underline(String(chromiumBinary || 'auto'))}\n` +
    `${colors.gray('GECKO_BINARY')} ${colors.underline(String(geckoBinary || 'auto'))}`
  )
}

export function debugOutputPath(pathValue: string) {
  return `${getLoggingPrefix('info')} Output Path\n${colors.gray('PATH')} ${colors.underline(pathValue)}`
}

export function debugPreviewOutput(outputPath: string, distPath: string) {
  return (
    `${getLoggingPrefix('info')} Preview Output\n` +
    `${colors.gray('OUTPUT')} ${colors.underline(outputPath)}\n` +
    `${colors.gray('DIST')} ${colors.underline(distPath)}`
  )
}

export function debugContextPath(packageJsonDir: string) {
  return `${getLoggingPrefix('info')} Context\n${colors.gray('CONTEXT')} ${colors.underline(packageJsonDir)}`
}

export function debugExtensionsToLoad(extensions: string[]) {
  const header = `${getLoggingPrefix('info')} Extensions To Load (${extensions.length})`
  const list = extensions.map((e) => `- ${colors.underline(e)}`).join('\n')
  return `${header}\n${list}`
}

export function noCompanionExtensionsResolved() {
  return (
    `${getLoggingPrefix('warn')} No companion extensions resolved from ${colors.underline('extensions')} config.\n` +
    `${colors.gray(
      'Ensure each companion extension is an unpacked extension directory containing a manifest.json (e.g., ./extensions/<name>/manifest.json).'
    )}`
  )
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

export function configLoadingError(configPath: string, error: unknown) {
  return (
    `${colors.red('ERROR')} ${colors.brightBlue('config load failed')}\n` +
    `${fmt.label('PATH')} ${fmt.val(configPath)}\n` +
    colors.red(fmt.truncate(error, 1200))
  )
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
