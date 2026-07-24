// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Stats, StatsAsset} from '@rspack/core'
import colors from 'pintor'
import type {DevOptions, Manifest} from '../types'
import {isGeckoBasedBrowser} from './constants'
import {stripBom} from './parse-json-safe'

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
    return s.length > max ? `${s.slice(0, max)}…` : s
  }
}

function getLoggingPrefix(type: 'warn' | 'info' | 'error' | 'success'): string {
  const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'

  if (isAuthor) {
    const base = type === 'error' ? 'ERROR Author says' : '⏵⏵⏵ Author says'
    return colors.brightMagenta(base)
  }

  if (type === 'error') return colors.red('ERROR')
  if (type === 'warn') return colors.brightYellow('⏵⏵⏵')
  if (type === 'info') return colors.gray('⏵⏵⏵')

  return colors.green('⏵⏵⏵')
}

function isPathLike(input: string) {
  return input.includes('/') || input.includes('\\') || path.isAbsolute(input)
}

export function resolvedWorkspaceManifest(
  projectPath: string,
  manifestPath: string
) {
  const manifestDir = path.dirname(manifestPath)
  const packageDir =
    path.basename(manifestDir) === 'src'
      ? path.dirname(manifestDir)
      : manifestDir
  const display = path.relative(projectPath, packageDir) || packageDir
  return `${getLoggingPrefix('info')} ${colors.gray(
    'Workspace root detected, resolved extension package:'
  )} ${colors.brightBlue(display)}`
}

export function remoteFetchTimedOut(target: string, ms: number) {
  return (
    `${getLoggingPrefix('error')} Timed out after ${colors.yellow(
      `${Math.round(ms / 1000)}s`
    )} fetching ${colors.underline(target)}.\n` +
    `${colors.red(
      'Check your network, or set EXTENSION_FETCH_TIMEOUT_MS to allow more time.'
    )}`
  )
}

export function manifestInvalidJson(manifestPath: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error)
  return (
    `${getLoggingPrefix('error')} Could not parse manifest.json. It is not valid JSON.\n` +
    `${colors.red('Fix the syntax error and try again.')}\n` +
    `${colors.gray('PATH')} ${colors.underline(manifestPath)}\n` +
    `${colors.red(detail)}`
  )
}

export function notAnExtensionManifestError(manifestPath: string) {
  return (
    `${getLoggingPrefix('error')} manifest.json is not a browser extension manifest. It has no ${colors.yellow('manifest_version')} field.\n` +
    `${colors.red(
      'This looks like a PWA web-app manifest. Point Extension.js at the directory that contains your extension manifest.'
    )}\n` +
    `${colors.gray('PATH')} ${colors.underline(manifestPath)}`
  )
}

export function manifestNotFoundError(
  manifestPath: string,
  candidates: string[] = []
) {
  const base =
    `${getLoggingPrefix('error')} Manifest file not found.\n` +
    `${colors.red('Ensure the path to your extension exists and try again.')}` +
    `\n${colors.red('NOT FOUND')}\n${colors.gray('PATH')} ${colors.underline(manifestPath)}`

  if (!candidates.length) return base

  const projectRoot = path.dirname(manifestPath)
  const hint =
    candidates.length === 1
      ? `Did you mean to point at this workspace package?`
      : `Did you mean to point at one of these workspace packages?`
  const suggestions = candidates
    .map((candidate) => {
      // Suggest the directory that contains the manifest, that's the path the
      // user passes to `extension dev`, not the manifest file itself.
      const dir =
        path.basename(candidate) === 'manifest.json'
          ? path.dirname(candidate)
          : candidate
      const normalized = path.basename(dir) === 'src' ? path.dirname(dir) : dir
      const display = path.isAbsolute(normalized)
        ? path.relative(projectRoot, normalized) || normalized
        : normalized
      return `  extension dev ${display}`
    })
    .join('\n')

  return `${base}\n\n${colors.gray(hint)}\n${colors.brightBlue(suggestions)}`
}

export function building(browser: DevOptions['browser']): string {
  const extensionOutput = isGeckoBasedBrowser(String(browser))
    ? 'Add-on'
    : 'Extension'

  return (
    `${getLoggingPrefix('info')} Building ${capitalizedBrowserName(browser)} ` +
    `${extensionOutput} package...`
  )
}

export function previewing(browser: DevOptions['browser']) {
  return `${getLoggingPrefix('info')} Previewing the extension on ${capitalizedBrowserName(browser)}...`
}

export function previewSkippedNoBrowser(browser: DevOptions['browser']) {
  return `${getLoggingPrefix('info')} Skipping browser launch for ${capitalizedBrowserName(browser)} (no-browser).`
}

// The browser accepted a dist it had refused, so the guest is running now.
export function extensionLoadRecovered() {
  return `${getLoggingPrefix('success')} The browser accepted the extension. It is running now.`
}

// Still refused after an edit: the reason is the browser's current answer,
// not a replay of the one printed at launch.
export function extensionLoadStillRefused(reason: string) {
  return (
    `${getLoggingPrefix('error')} The browser still refuses to load this extension.\n` +
    `${colors.gray('REASON')} ${colors.red(reason)}`
  )
}

// A launcher that throws leaves a session with no browser to drive. The
// emitter alone cannot report it: its default 'error' listener discards.
export function browserLaunchFailed(
  browser: DevOptions['browser'],
  reason: string
) {
  return (
    `${getLoggingPrefix('error')} ${capitalizedBrowserName(browser)} could not be started, so the extension is NOT running.\n` +
    `${reason}\n` +
    `The dev server keeps watching, but nothing will load until this is fixed.`
  )
}

export function authorInstallNotice(target: string) {
  return `${getLoggingPrefix('warn')} Author mode: installing ${target}.`
}

export function projectInstallFallbackToNpm(pmName: string) {
  return `${getLoggingPrefix('warn')} Dependency install with ${pmName} failed. Retrying once with npm so the build can continue.`
}

export function projectInstallScriptsDisabled(pmName: string) {
  return `${getLoggingPrefix('info')} Installing project dependencies with ${pmName}. Lifecycle scripts are disabled for safety, set EXTENSION_ALLOW_INSTALL_SCRIPTS=true to run them.`
}

export function buildWebpack(
  projectDir: string,
  stats: Stats | undefined,
  browser: DevOptions['browser']
): string {
  const statsJson = stats?.toJson?.({
    all: false,
    assets: true,
    timings: true
  })
  const outputPath =
    typeof stats?.compilation?.outputOptions?.path === 'string'
      ? stats.compilation.outputOptions.path
      : ''
  // Failed builds may not emit manifest.json; fall back to the project manifest
  // so this summary never throws inside the compiler.run callback.
  const distManifestPath = outputPath
    ? path.join(outputPath, 'manifest.json')
    : ''
  const manifestPath =
    distManifestPath && fs.existsSync(distManifestPath)
      ? distManifestPath
      : path.join(projectDir, 'manifest.json')
  let manifest: Record<string, string> = {}
  try {
    manifest = JSON.parse(stripBom(fs.readFileSync(manifestPath, 'utf8')))
  } catch {
    manifest = {name: path.basename(projectDir), version: ''}
  }
  const assets: StatsAsset[] = statsJson?.assets || []
  const heading = `${getLoggingPrefix('info')} Building ${colors.blue(
    manifest.name
  )} extension using ${capitalizedBrowserName(browser)} defaults...\n`
  const buildTime = `\nBuild completed in ${(
    (statsJson?.time || 0) / 1000
  ).toFixed(2)} seconds.\n`
  const buildTarget = `Build Target: ${colors.gray(capitalizedBrowserName(browser))}\n`
  const buildStatus = `Build Status: ${
    stats?.hasErrors?.() ? colors.red('Failed') : colors.green('Success')
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
  )} Build succeeded with no warnings. Your extension is ${colors.green(
    'ready for deployment'
  )}.`
}

type BuildWarningCategory =
  | 'Performance'
  | 'Deprecation'
  | 'Configuration'
  | 'Compatibility'
  | 'Runtime-risk'
  | 'Warning'

// Bundler warnings arrive in several shapes (strings, rspack WebpackError,
// plugin objects); this loose view lists every field the formatters probe.
type LooseBuildWarning =
  | string
  | null
  | undefined
  | {
      message?: unknown
      details?: unknown
      reason?: unknown
      description?: unknown
      name?: unknown
      moduleName?: unknown
      moduleIdentifier?: unknown
      originName?: unknown
      pluginName?: unknown
      file?: unknown
      chunkName?: unknown
    }

function getWarningMessage(warning: LooseBuildWarning): string {
  if (!warning) return ''
  if (typeof warning === 'string') return warning.trim()

  const candidates = [
    warning.message,
    warning.details,
    warning.reason,
    warning.description
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return ''
}

function getWarningSource(warning: LooseBuildWarning): string {
  if (!warning || typeof warning === 'string') return 'bundler'

  const candidates = [
    warning.name,
    warning.moduleName,
    warning.moduleIdentifier,
    warning.originName,
    warning.pluginName
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return 'bundler'
}

function getWarningArtifact(warning: LooseBuildWarning): string {
  if (!warning || typeof warning === 'string') return ''

  const candidates = [warning.file, warning.chunkName, warning.moduleName]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return ''
}

function classifyWarning(
  message: string,
  source: string
): BuildWarningCategory {
  const haystack = `${message} ${source}`.toLowerCase()

  if (
    haystack.includes('performance') ||
    haystack.includes('asset size') ||
    haystack.includes('entrypoint size') ||
    haystack.includes('exceeds the recommended size') ||
    haystack.includes('hints')
  ) {
    return 'Performance'
  }

  if (
    haystack.includes('deprecat') ||
    haystack.includes('[dep_') ||
    haystack.includes('legacy')
  ) {
    return 'Deprecation'
  }

  if (
    haystack.includes('invalid') ||
    haystack.includes('unknown option') ||
    haystack.includes('configuration') ||
    haystack.includes('schema')
  ) {
    return 'Configuration'
  }

  if (
    haystack.includes('manifest') ||
    haystack.includes('browser') ||
    haystack.includes('target')
  ) {
    return 'Compatibility'
  }

  if (
    haystack.includes('runtime') ||
    haystack.includes('will fail') ||
    haystack.includes('cannot resolve') ||
    haystack.includes('service_worker')
  ) {
    return 'Runtime-risk'
  }

  return 'Warning'
}

function suggestedHintForWarning(category: BuildWarningCategory): string {
  if (category === 'Performance') {
    return 'Inspect the largest startup bundles and split optional code paths.'
  }
  if (category === 'Deprecation') {
    return 'Move to the supported API or plugin path before the next update.'
  }
  if (category === 'Configuration') {
    return 'Review extension and bundler config keys, then remove or rename invalid options.'
  }
  if (category === 'Compatibility') {
    return 'Verify browser target and manifest compatibility for this build.'
  }
  if (category === 'Runtime-risk') {
    return 'Address this before release; it may fail or degrade at runtime.'
  }
  return 'Re-run with EXTENSION_VERBOSE=1 to inspect full warning details.'
}

export function buildSuccessWithWarnings(warningCount: number) {
  return `${getLoggingPrefix(
    'warn'
  )} Build succeeded with ${warningCount} warning(s). Your extension is ${colors.green(
    'ready for deployment'
  )}.`
}

export function buildWarningsDetails(warnings: LooseBuildWarning[]): string {
  if (!Array.isArray(warnings) || warnings.length === 0) return ''

  const blocks: string[] = []

  warnings.forEach((warning, index) => {
    const message = getWarningMessage(warning)
    const source = getWarningSource(warning)
    const artifact = getWarningArtifact(warning)
    const category = classifyWarning(message, source)
    const hint = suggestedHintForWarning(category)

    if (!message) {
      blocks.push(
        `${getLoggingPrefix('warn')} Warning ${index + 1}: details were suppressed by tool output.\n` +
          `${formatWarningLabelLine('Source', colors.gray(source))}\n` +
          `${formatWarningLabelLine(
            'Hint',
            'Re-run with EXTENSION_VERBOSE=1 to inspect full warning messages.'
          )}`
      )
      return
    }

    const performanceWarning = parsePerformanceWarning(
      warning,
      source,
      artifact
    )
    if (performanceWarning) {
      blocks.push(performanceWarning)
      return
    }

    const oneLine = message.replace(/\s+/g, ' ').trim()
    const artifactSuffix = artifact ? ` ${colors.gray(`(${artifact})`)}` : ''
    blocks.push(
      `${getLoggingPrefix('warn')} ${category}: ${oneLine}${artifactSuffix}\n` +
        `${formatWarningLabelLine('Source', colors.gray(source))}\n` +
        `${formatWarningLabelLine('Hint', hint)}`
    )
  })

  return blocks.join('\n\n')
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

export function writingTypeDefinitions(manifest: Manifest) {
  return (
    `${getLoggingPrefix('info')} ` +
    `Writing type definitions for ${colors.blue(manifest.name || '')}...`
  )
}

export function writingTypeDefinitionsError(error: unknown) {
  return `${getLoggingPrefix(
    'error'
  )} Failed to write the extension type definition.\n${colors.red(String(error))}`
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

export function failedToDownloadOrExtractZIPFileError(error: unknown) {
  return (
    `${getLoggingPrefix('error')} ` +
    `Failed to download or extract ZIP file.\n${colors.red(String(error))}`
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

export function notAZipArchive(source: string, contentType?: string) {
  return (
    `${getLoggingPrefix('error')} ` +
    `The downloaded content is not a ZIP archive.\n` +
    `${colors.gray('SOURCE')} ${colors.underline(source)}\n` +
    (contentType
      ? `${colors.gray('Content-Type')} ${colors.underline(contentType)}\n`
      : '') +
    `This usually means the URL requires authentication (for example a ` +
    `Slack, Google Drive, or Dropbox file page) and returned an HTML login ` +
    `page instead of the file. Download the ZIP through the browser and pass ` +
    `the local path instead, or use a direct-download URL.`
  )
}

export function localZipNotFound(zipFilePath: string) {
  return (
    `${getLoggingPrefix('error')} ` +
    `ZIP file not found.\n` +
    `${colors.gray('PATH')} ${colors.underline(zipFilePath)}`
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
    totalSize += asset?.size || 0
  })

  return getFileSize(totalSize)
}

interface AssetTreeNode {
  size?: number
  [child: string]: AssetTreeNode | number | undefined
}

function printTree(node: AssetTreeNode, prefix = ''): string {
  let output = ''

  Object.keys(node).forEach((key, index, array) => {
    const isLast = index === array.length - 1
    const connector = isLast ? '└─' : '├─'
    const child = node[key]
    const childNode = child && typeof child === 'object' ? child : undefined
    // A leaf is any node carrying a numeric size, including 0: testing the
    // number's truthiness printed a 0-byte asset as a folder holding "size".
    const isLeaf = typeof childNode?.size === 'number'
    const sizeInKB = isLeaf ? ` (${getFileSize(childNode?.size ?? 0)})` : ''
    output += `${colors.gray(prefix)}${colors.gray(connector)} ${key}${colors.gray(sizeInKB)}\n`
    if (childNode && !isLeaf) {
      output += printTree(
        childNode,
        `${prefix}${isLast ? '   ' : colors.gray('│  ')}`
      )
    }
  })

  return output
}

function getAssetsTree(assets: StatsAsset[] | undefined): string {
  const assetTree: Record<string, {size: number}> = {}

  assets?.forEach((asset) => {
    // Failed builds can report asset stubs without a name; skip them
    // instead of throwing inside the compiler.run callback.
    if (typeof asset?.name !== 'string') return
    const paths = asset.name.split('/')
    let currentLevel: AssetTreeNode = assetTree

    paths.forEach((part, index) => {
      if (!currentLevel[part]) {
        currentLevel[part] = {}
      }
      if (index === paths.length - 1) {
        currentLevel[part] = {size: asset.size}
      } else {
        currentLevel = currentLevel[part] as AssetTreeNode
      }
    })
  })

  return `.\n${printTree(assetTree)}`
}

function formatWarningLabelLine(label: string, value: string): string {
  return `${colors.gray('│')}  ${colors.gray(`${label}:`)} ${value}`
}

function parsePerformanceWarning(
  warning: LooseBuildWarning,
  source: string,
  _artifact: string
): string | undefined {
  const normalized = getWarningBody(warning).replace(/\r/g, '')
  const lower = normalized.toLowerCase()
  const threshold =
    normalized.match(/\(([\d.]+\s(?:KiB|MiB|GiB|KB|MB|GB))\)/)?.[1] || ''

  if (lower.includes('asset size limit')) {
    return formatPerformanceWarningBlock({
      title: 'asset size limit exceeded',
      threshold,
      impact:
        'Large emitted files can increase package size and slow extension startup.',
      source,
      hint: 'Inspect the largest startup bundles and split optional code paths.'
    })
  }

  if (lower.includes('entrypoint size limit')) {
    return formatPerformanceWarningBlock({
      title: 'entrypoint size limit exceeded',
      threshold,
      impact: 'Startup entrypoints are heavier than recommended.',
      source,
      hint: 'Keep startup entrypoints thin and defer non-critical code.'
    })
  }

  return undefined
}

function formatPerformanceWarningBlock(options: {
  title: string
  threshold: string
  impact: string
  source: string
  hint: string
}): string {
  const lines = [`${getLoggingPrefix('warn')} Performance: ${options.title}`]

  if (options.threshold) {
    lines.push(formatWarningLabelLine('Threshold', options.threshold))
  }
  lines.push(formatWarningLabelLine('Impact', options.impact))

  lines.push(colors.gray('│'))
  lines.push(formatWarningLabelLine('Source', colors.gray(options.source)))
  lines.push(formatWarningLabelLine('Hint', options.hint))

  return lines.join('\n')
}

function getWarningBody(warning: LooseBuildWarning): string {
  if (!warning) return ''
  if (typeof warning === 'string') return warning

  return [warning.message, warning.details, warning.reason, warning.description]
    .filter(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0
    )
    .join('\n')
}

export function isUsingExperimentalConfig(integration: unknown) {
  return `${getLoggingPrefix('info')} Using ${colors.yellow(String(integration))}.`
}

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

export function configLoadingError(configPath: string, error: unknown) {
  return (
    `${colors.red('ERROR')} ${colors.brightBlue('config load failed')}\n` +
    `${fmt.label('PATH')} ${fmt.val(configPath)}\n` +
    colors.red(fmt.truncate(error, 1200))
  )
}

export function buildCommandFailed(error: unknown) {
  const message = (() => {
    if (error instanceof Error && error.message) return error.message
    return String(error || 'Unknown error')
  })()
  return (
    `${getLoggingPrefix('error')} Build failed.\n` +
    `${colors.red(fmt.truncate(message, 1200))}`
  )
}

export function devCommandFailed(error: unknown) {
  const message = (() => {
    if (error instanceof Error && error.message) return error.message
    return String(error || 'Unknown error')
  })()
  return (
    `${getLoggingPrefix('error')} Dev mode failed.\n` +
    `${colors.red(fmt.truncate(message, 1200))}`
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
