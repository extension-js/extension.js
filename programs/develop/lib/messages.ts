// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import type {Stats, StatsAsset} from '@rspack/core'
import colors from 'pintor'
import type {DevOptions, Manifest} from '../types'
import {artifactNoun, type Channel, fmt, prefix} from './messaging'

// Imported for local use and re-exported: consumers and snapshots read fmt
// from this module, and the definition now lives in messaging.ts.
export {fmt}

function getLoggingPrefix(type: Channel): string {
  return prefix(type)
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
  return (
    `${getLoggingPrefix('info')} ${colors.gray('Workspace root detected.')}\n` +
    `${colors.gray('PACKAGE')} ${colors.brightBlue(display)}`
  )
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
    `${getLoggingPrefix('error')} Could not parse manifest.json.\n` +
    `It is not valid JSON.\n` +
    `${colors.red('Fix the syntax error and try again.')}\n` +
    `${colors.gray('PATH')} ${colors.underline(manifestPath)}\n` +
    `${colors.red(detail)}`
  )
}

export function notAnExtensionManifestError(manifestPath: string) {
  return (
    `${getLoggingPrefix('error')} manifest.json is not a browser extension manifest.\n` +
    `It has no ${colors.yellow('manifest_version')} field.\n` +
    `${colors.red('This looks like a PWA web-app manifest.')}\n` +
    `${colors.red(
      'Point Extension.js at the directory that contains your extension manifest.'
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
  const extensionOutput = artifactNoun(String(browser))

  return (
    `${getLoggingPrefix('info')} Build the ${capitalizedBrowserName(browser)} ` +
    `${extensionOutput} package.`
  )
}

export function previewing(
  browser: DevOptions['browser'],
  noBrowser?: boolean
) {
  const suffix = noBrowser ? ' (no-browser mode)' : ''
  return `${getLoggingPrefix('info')} Previewing on ${capitalizedBrowserName(browser)}${suffix}.`
}

export function starting(browser: DevOptions['browser'], noBrowser?: boolean) {
  const suffix = noBrowser ? ' (no-browser mode)' : ''
  return `${getLoggingPrefix('info')} Starting on ${capitalizedBrowserName(browser)}${suffix}.`
}

// The browser accepted a dist it had refused, so the guest is running now.
export function extensionLoadRecovered() {
  return (
    `${getLoggingPrefix('success')} The browser accepted the extension.\n` +
    `It is running now.`
  )
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
  return `${prefix('debug')} install  target=${target}`
}

export function projectInstallFallbackToNpm(pmName: string) {
  return (
    `${getLoggingPrefix('warn')} Dependency install with ${pmName} failed.\n` +
    `Extension.js retries once with npm so the build can continue.`
  )
}

export function projectInstallScriptsDisabled(pmName: string) {
  return (
    `${getLoggingPrefix('info')} Install the project dependencies with ${pmName}.\n` +
    `Lifecycle scripts are disabled for safety.\n` +
    `Set EXTENSION_ALLOW_INSTALL_SCRIPTS=true to run them.`
  )
}

export function buildAssetsTree(stats: Stats | undefined): string {
  const statsJson = stats?.toJson?.({
    all: false,
    assets: true
  })
  const assets: StatsAsset[] = statsJson?.assets || []
  return getAssetsTree(assets)
}

export function buildComplete(
  browser: DevOptions['browser'],
  distDisplayPath: string,
  totalBytes?: number
) {
  const noun = artifactNoun(String(browser))
  const size =
    typeof totalBytes === 'number' && totalBytes > 0
      ? ` (${getHumanSize(totalBytes)})`
      : ''
  return (
    `${getLoggingPrefix('success')} ${noun} built for production in ` +
    `${colors.underline(distDisplayPath)}${size}.`
  )
}

export function buildFailed(errorCount: number) {
  const count = Math.max(1, Math.floor(errorCount || 1))
  const noun = count === 1 ? 'error' : 'errors'
  return `${getLoggingPrefix('error')} Build failed with ${count} ${noun}.`
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
  return fmt.block('Fetch project', [
    ['URL', fmt.val(`https://github.com/${owner}/${project}`)]
  ])
}

export function downloadingProjectPath(projectName: string) {
  const formatted = isPathLike(projectName)
    ? colors.underline(projectName)
    : colors.yellow(projectName)
  return `${getLoggingPrefix('info')} Download ${formatted}.`
}

export function creatingProjectPath(projectPath: string) {
  return (
    `${getLoggingPrefix('info')} Create a new browser extension.\n` +
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
  return `${prefix('debug')} zip      pack=source gitignore=excluded path=${zipPath}`
}

export function zipArtifactReady(zipPath: string, sizeInBytes: number) {
  return (
    `${getLoggingPrefix('success')} Packaged ${colors.underline(zipPath)} ` +
    `(${getHumanSize(sizeInBytes)}).`
  )
}

export function packagingDistributionFiles(zipPath: string) {
  return `${prefix('debug')} zip      pack=dist path=${zipPath}`
}

export function treeWithSourceAndDistFiles(
  browser: DevOptions['browser'],
  name: string,
  sourceZip: string,
  destZip: string
) {
  return (
    `${prefix('debug')} zip      name=${name} browser=${String(browser)} ` +
    `source=${sourceZip} dist=${destZip}`
  )
}

export function treeWithDistFilesBrowser(
  name: string,
  ext: string,
  browser: DevOptions['browser'],
  zipPath: string
) {
  return (
    `${prefix('debug')} zip      name=${name}.${ext} ` +
    `browser=${String(browser)} dist=${zipPath}`
  )
}

export function treeWithSourceFiles(
  name: string,
  ext: string,
  browser: DevOptions['browser'],
  zipPath: string
) {
  return (
    `${prefix('debug')} zip      name=${name}-source.${ext} ` +
    `browser=${String(browser)} source=${zipPath}`
  )
}

export function writingTypeDefinitions(manifest: Manifest) {
  return (
    `${getLoggingPrefix('info')} ` +
    `Write the type definitions for ${colors.blue(manifest.name || '')}.`
  )
}

export function writingTypeDefinitionsError(error: unknown) {
  return (
    `${getLoggingPrefix('error')} Failed to write the extension type definition.\n` +
    `Check the file permissions, then try again.\n` +
    `${colors.red(String(error))}`
  )
}

export function downloadingText(url: string) {
  return fmt.block('Download extension', [['URL', fmt.val(url)]])
}

export function unpackagingExtension(zipFilePath: string) {
  return (
    `${getLoggingPrefix('info')} Unpackage the browser extension.\n` +
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
    `Failed to download or extract ZIP file.\n` +
    `Check the URL and your network, then try again.\n` +
    `${colors.red(String(error))}`
  )
}

export function invalidRemoteZip(url: string, contentType: string) {
  return (
    `${getLoggingPrefix('error')} ` +
    `Remote URL does not appear to be a ZIP archive.\n` +
    `Use a direct-download URL, or download the file and pass the local path.\n` +
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
    `page instead of the file.\n` +
    `Download the ZIP through the browser and pass the local path instead, ` +
    `or use a direct-download URL.`
  )
}

export function localZipNotFound(zipFilePath: string) {
  return (
    `${getLoggingPrefix('error')} ` +
    `ZIP file not found.\n` +
    `Check the path and try again.\n` +
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

function getHumanSize(sizeInBytes: number): string {
  const bytes = Math.max(0, sizeInBytes || 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

  if (Object.keys(assetTree).length === 0) return ''

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
  return `${prefix('debug')} config   using=${String(integration)}`
}

export function debugDirs(manifestDir: string, packageJsonDir: string) {
  return `${prefix('debug')} dirs     manifest=${manifestDir} pkg=${packageJsonDir}`
}

export function debugBrowser(
  browser: DevOptions['browser'],
  chromiumBinary?: string,
  geckoBinary?: string
) {
  return (
    `${prefix('debug')} browser  target=${String(browser)} ` +
    `chromiumBinary=${String(chromiumBinary || 'auto')} ` +
    `geckoBinary=${String(geckoBinary || 'auto')}`
  )
}

export function debugOutputPath(pathValue: string) {
  return `${prefix('debug')} output   path=${pathValue}`
}

export function debugPreviewOutput(outputPath: string, distPath: string) {
  return `${prefix('debug')} preview  output=${outputPath} dist=${distPath}`
}

export function debugContextPath(packageJsonDir: string) {
  return `${prefix('debug')} context  path=${packageJsonDir}`
}

export function debugExtensionsToLoad(extensions: string[]) {
  return (
    `${prefix('debug')} extensions count=${extensions.length} ` +
    `paths=${extensions.join(',')}`
  )
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
    `${getLoggingPrefix('error')} Could not load ${colors.brightBlue('extension.config.js')}.\n` +
    `Fix the config file, then run the command again.\n` +
    `${fmt.label('PATH')} ${fmt.val(configPath)}\n` +
    colors.red(fmt.truncate(error, 1200))
  )
}

export function buildCommandFailed(error: unknown) {
  const message = (() => {
    if (error instanceof Error && error.message) return error.message
    return String(error || 'Unknown error')
  })()
  // A message carrying its own error glyph is already a rendered block, so a
  // second "Build failed." headline on top of it would double the label line.
  if (message.includes(getLoggingPrefix('error'))) return message
  return `${getLoggingPrefix('error')} ${colors.red(fmt.truncate(message, 1200))}`
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
    `${getLoggingPrefix('error')} Your project declares dependencies that are managed by ${colors.blue('Extension.js')} and referenced in ${colors.underline('extension.config.js')}.\n` +
    `${colors.red('This can cause version conflicts and break the development/build process.')}\n\n` +
    `${colors.gray('Managed dependencies (remove these from your package.json):')}\n` +
    `${list}\n\n` +
    `${colors.gray('PATH')} ${colors.underline(userPackageJsonPath)}\n` +
    `If you need a different version, open an issue so we can consider bundling it safely.\n` +
    `Operation aborted.`
  )
}
