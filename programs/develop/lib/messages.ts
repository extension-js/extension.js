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
import {
  artifactNoun,
  type Channel,
  fmt,
  hasChannelPrefix,
  prefix,
  stripChannelPrefix
} from './messaging'
import {foldOutputFiles, type OutputFile} from './output-files'

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
    `${colors.gray('PACKAGE')} ${colors.underline(display)}`
  )
}

// Said out loud because the alternative is a build whose output, special
// folders and install all silently belong to a project the author never named.
export function declinedProjectRoot(
  projectManifestPath: string,
  manifestPath: string
) {
  const manifestDir = path.dirname(manifestPath)

  return (
    `${getLoggingPrefix('info')} ${colors.gray(`Using ${path.basename(manifestDir)}/ as the project root.`)}\n` +
    `${colors.gray('IGNORED')} ${colors.underline(projectManifestPath)}\n` +
    `${colors.gray('That project does not depend on Extension.js, so its dist, its special folders and its dependencies stay out of this build. Add a package.json next to your manifest, or depend on Extension.js there, to use it as the project root.')}`
  )
}

export function remoteFetchTimedOut(target: string, ms: number) {
  return (
    `${getLoggingPrefix('error')} Timed out after ${Math.round(ms / 1000)} s fetching the remote file.\n` +
    `${colors.gray('URL')} ${colors.underline(target)}\n` +
    `Check your network, or set ${colors.blue('EXTENSION_FETCH_TIMEOUT_MS')} to allow more time.`
  )
}

export function manifestInvalidJson(manifestPath: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error)

  return (
    `${getLoggingPrefix('error')} Couldn't parse manifest.json as JSON.\n` +
    `${colors.gray('PATH')} ${colors.underline(manifestPath)}\n` +
    `${colors.gray('REASON')} ${colors.red(detail)}\n` +
    `Fix the syntax error, then run the command again.`
  )
}

export function notAnExtensionManifestError(manifestPath: string) {
  return (
    `${getLoggingPrefix('error')} manifest.json isn't a browser extension manifest.\n` +
    `It has no ${colors.blue('manifest_version')} field, so it looks like a PWA web-app manifest.\n` +
    `${colors.gray('PATH')} ${colors.underline(manifestPath)}\n` +
    `Point Extension.js at the directory that contains your extension manifest.`
  )
}

export function previewHasNothingToRun(manifestAtOutput: string) {
  return (
    `${getLoggingPrefix('error')} Preview is run-only and does not compile.\n` +
    `${colors.gray('NOT FOUND')} ${colors.underline(manifestAtOutput)}\n` +
    `Run ${colors.blue('extension build')} first, or pass ${colors.blue('--output-path')} an unpacked extension directory.`
  )
}

export function manifestNotFoundError(
  manifestPath: string,
  candidates: string[] = []
) {
  const base =
    `${getLoggingPrefix('error')} Manifest file not found.\n` +
    `${colors.gray('NOT FOUND')} ${colors.underline(manifestPath)}\n` +
    `Ensure the path to your extension exists, then try again.`

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

  return `${base}\n\n${colors.gray(hint)}\n${colors.blue(suggestions)}`
}

export function companionManifestNotProjectError(
  manifestPath: string,
  companionManifestPath: string
) {
  const projectRoot = path.dirname(manifestPath)
  const companionDir = path.dirname(companionManifestPath)
  const display = path.relative(projectRoot, companionDir) || companionDir

  return (
    `${getLoggingPrefix('error')} Manifest file not found.\n` +
    `${colors.gray('NOT FOUND')} ${colors.underline(manifestPath)}\n` +
    `The only manifest.json here belongs to a companion extension under ${colors.blue('extensions/')}.\n` +
    `Companions load next to your extension and never stand in for it.\n` +
    `${colors.gray('COMPANION')} ${colors.underline(display)}\n` +
    `Add a manifest.json at the project root or in ${colors.blue('src/')}, or point Extension.js at your extension's directory.`
  )
}

// The run-only preview quietly serves the SOURCE manifest dir when
// dist/<browser> is absent (typical after `build --browser all`, which
// writes chrome/edge/firefox but not the default chromium target). Say so,
// or the user previews unbuilt files and blames the build.
// A first dev session or build appends one line to the project's own
// .gitignore; a tracked file changing under the user is said out loud.
export function sessionStateIgnoreAdded(gitignorePath: string) {
  return `${getLoggingPrefix('info')} Added .extension-js to ${gitignorePath} so the local session state stays out of commits.`
}

export function previewingSourceFallback(
  browser: DevOptions['browser'],
  distDir: string
) {
  return (
    `${getLoggingPrefix('warn')} No production build found at ${distDir}, previewing the source manifest directory instead.\n` +
    `Run \`extension build --browser ${String(browser)}\` first to preview the built output.`
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
    `It's running now.`
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
    `${getLoggingPrefix('error')} ${capitalizedBrowserName(browser)} couldn't start, so the extension isn't running.\n` +
    // The reason is often a block of its own. Inside this one it is a detail,
    // so it loses its glyph and the frame stays one frame.
    `${hasChannelPrefix(reason) ? stripChannelPrefix(reason) : reason}\n` +
    `The dev server keeps watching, but nothing will load until this is fixed.`
  )
}

export function authorInstallNotice(target: string) {
  return `${prefix('debug')} install  target=${target}`
}

export function projectInstallInWorkspaceRoot(workspaceRoot: string) {
  return (
    `${getLoggingPrefix('info')} This project is a pnpm workspace member, ` +
    `installing from the workspace root at ${colors.blue(workspaceRoot)}.`
  )
}

export function projectInstallFallbackToNpm(pmName: string) {
  return (
    `${getLoggingPrefix('warn')} Dependency install with ${pmName} failed.\n` +
    `Extension.js retries once with npm so the build can continue.`
  )
}

export function projectInstallScriptsDisabled(pmName: string) {
  return (
    `${getLoggingPrefix('info')} Installing the project dependencies with ${pmName}…\n` +
    `Lifecycle scripts are disabled for safety.\n` +
    `Set ${colors.blue('EXTENSION_ALLOW_INSTALL_SCRIPTS=true')} to run them.`
  )
}

export function anotherDevSessionActive(
  browser: string,
  pid: number,
  runId: string
) {
  const run = runId ? `, run ${runId}` : ''

  return (
    `${getLoggingPrefix('warn')} Another dev session is already writing dist/${browser} (PID ${pid}${run}).\n` +
    `Both sessions rebuild the same output, so the last compile wins.\n` +
    `Stop the other session, or pass ${fmt.code('--instance-id')} to run them side by side.`
  )
}

export function buildAssetsTree(
  stats: Stats | undefined,
  outputFiles?: OutputFile[]
): string {
  const statsJson = stats?.toJson?.({
    all: false,
    assets: true
  })
  const assets: StatsAsset[] = statsJson?.assets || []
  const tree = getAssetsTree(assets)

  if (!tree || !outputFiles?.length) return tree

  const folded = foldOutputFiles(
    outputFiles,
    assets.map((asset) => asset?.name)
  )

  if (folded.count === 0) return tree

  const noun = folded.sourceMapsOnly ? 'source map' : 'file'

  return (
    tree +
    colors.gray(
      `+ ${pluralize(folded.count, noun)} not shown (${getFileSize(folded.bytes)})`
    ) +
    '\n'
  )
}

export function buildComplete(
  browser: DevOptions['browser'],
  distDisplayPath: string,
  totalBytes?: number,
  mode?: 'development' | 'production' | 'none'
) {
  const noun = artifactNoun(String(browser))
  // The closer said production whatever the build ran as, so a build passed
  // --mode development finished by reporting the opposite of what it did.
  const builtFor =
    mode === 'development'
      ? 'built for development in'
      : mode === 'none'
        ? 'built in'
        : 'built for production in'
  const size =
    typeof totalBytes === 'number' && totalBytes > 0
      ? ` (${getHumanSize(totalBytes)})`
      : ''

  return (
    `${getLoggingPrefix('success')} ${noun} ${builtFor} ` +
    `${colors.underline(distDisplayPath)}${size}.`
  )
}

export function operaBuildUnminified() {
  return (
    `${getLoggingPrefix('info')} Opera Add-ons reviews readable source, so this build does ` +
    `not minify first-party code. Pass ${colors.blue('--minify')} to minify it anyway.`
  )
}

// The docs host for the share flow comes from the environment, so an unset
// value prints nothing instead of a dead link.
function platformDocsUrl(): string {
  return String(process.env.EXTENSION_DEV_DOCS_URL || '')
    .trim()
    .replace(/\/+$/, '')
}

function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function addonLintSummary(
  errorCount: number,
  warningCount: number,
  distDisplay: string
) {
  const parts: string[] = []
  if (errorCount > 0) parts.push(pluralize(errorCount, 'error'))
  if (warningCount > 0) parts.push(pluralize(warningCount, 'warning'))

  return (
    `${getLoggingPrefix('warn')} Store check for addons.mozilla.org: ` +
    `addons-linter found ${parts.join(' and ')} in ${colors.underline(distDisplay)}`
  )
}

// Linter errors get the warning glyph, linter warnings the quieter info one,
// so the ones AMO rejects outright stand apart at a glance.
export function addonLintFinding(
  level: 'error' | 'warning',
  code: string,
  message: string,
  location: string,
  attribution?: string
) {
  const glyph = getLoggingPrefix(level === 'error' ? 'warn' : 'info')
  const where = location ? ` ${colors.gray(`(${location})`)}` : ''
  const from = attribution ? ` ${colors.gray(attribution)}` : ''

  return `${glyph} AMO ${level} ${colors.yellow(code)}: ${message}${where}${from}`
}

// The finding stays, because AMO still reports it on a submission. What this
// adds is whose code it is, which the file name alone can get exactly wrong:
// `shared/framework.js` is our chunk name for the project's own dependencies.
export function addonLintDependencyAttribution(
  packages: string[],
  onlyDependencies: boolean
) {
  if (packages.length === 0) return ''

  const named = packages.slice(0, 3).join(', ')
  const rest = packages.length > 3 ? `, +${packages.length - 3} more` : ''

  return onlyDependencies
    ? `- this file is bundled dependency code (${named}${rest}), not yours`
    : `- this file also bundles ${named}${rest}, so the finding may be theirs`
}

export function addonLintMore(hiddenCount: number, distDisplay: string) {
  return (
    `${getLoggingPrefix('info')} ${pluralize(hiddenCount, 'more finding')} not shown. ` +
    `Run ${colors.blue(`npx addons-linter ${distDisplay}`)} for the full report.`
  )
}

export function addonLintNotInstalled(installHint: string) {
  return (
    `${getLoggingPrefix('info')} Skipped the addons.mozilla.org lint: addons-linter is not installed. ` +
    `Install it with: ${colors.blue(installHint)} or pass ${colors.blue('--no-addon-lint')} to silence this.`
  )
}

export function addonLintFailed(reason: string, distDisplay: string) {
  return (
    `${getLoggingPrefix('warn')} Store check for addons.mozilla.org did not finish: ${reason}. ` +
    `The build is complete, run ${colors.blue(`npx addons-linter ${distDisplay}`)} to see what AMO would flag.`
  )
}

export function addonLintFailedDebug(reason: string) {
  return `${getLoggingPrefix('debug')} addon-lint failed=true reason="${reason}"`
}

export function buildShareHint() {
  const docs = platformDocsUrl()
  if (!docs) return ''

  return (
    `${getLoggingPrefix('info')} Send this build to someone for review: ` +
    colors.underline(
      `${docs}/share/unpublished-build-for-review?utm_source=cli-build`
    )
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

// rspack wraps loader warnings in "Module Warning (from <loader path>):",
// which only repeats what the Source line already says.
function stripModuleWarningWrapper(message: string): string {
  return message.replace(/^Module (?:Warning|Error) \(from [^)]*\):\s*/, '')
}

// The bundler renders every warning it reports with a warning-sign head
// marker and a bar gutter on each following line. That is its frame, not
// the warning's text, so both are read off before the text is framed here.
function stripBundlerDecoration(message: string): string {
  return message
    .replace(/\r/g, '')
    .split('\n')
    .map((line, index) =>
      index === 0 ? line.replace(/^\s*⚠ ?/, '') : line.replace(/^\s*│ ?/, '')
    )
    .join('\n')
    .trim()
}

function cleanWarningText(message: string): string {
  return stripModuleWarningWrapper(stripBundlerDecoration(message))
}

function getWarningMessage(warning: LooseBuildWarning): string {
  if (!warning) return ''

  if (typeof warning === 'string') {
    return cleanWarningText(warning)
  }

  const candidates = [
    warning.message,
    warning.details,
    warning.reason,
    warning.description
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return cleanWarningText(candidate)
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
    return 'Address this before release. It may fail or degrade at runtime.'
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

    // A warning that opens with the channel glyph framed itself where it was
    // written, so it prints as is: no category, no source row, no hint.
    if (hasChannelPrefix(message)) {
      blocks.push(message)

      return
    }

    // A body with a second line explains itself. The generic hint is for the
    // one-line warnings the bundler reports with nothing else to go on.
    const [headline, ...body] = message
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    const explained = body.length > 0
    const artifactSuffix = artifact ? ` ${colors.gray(`(${artifact})`)}` : ''
    blocks.push(
      `${getLoggingPrefix('warn')} ${category}: ${headline}${artifactSuffix}\n` +
        body.map((line) => `${line}\n`).join('') +
        formatWarningLabelLine('Source', colors.gray(source)) +
        (explained ? '' : `\n${formatWarningLabelLine('Hint', hint)}`)
    )
  })

  return blocks.join('\n\n')
}

export function downloadingProjectPath(projectName: string, url: string) {
  const formatted = isPathLike(projectName)
    ? colors.underline(projectName)
    : projectName

  return (
    `${getLoggingPrefix('info')} Downloading ${formatted}…\n` +
    `${colors.gray('URL')} ${fmt.val(url)}`
  )
}

// A remote source lands in a folder the card's rows already point at. PATH
// is an error-evidence label, and the URL pathname it used to carry was
// never a directory on this machine.
export function creatingProjectPath() {
  return `${getLoggingPrefix('info')} Creating a new browser extension…`
}

// The tree is the one this tool recorded as fetched from this url, so it is
// reused as-is. Saying so is the difference between a cache and a download.
export function reusingDownloadedProject(destinationPath: string, url: string) {
  return (
    `${getLoggingPrefix('info')} Using the extension already downloaded here…\n` +
    `${colors.gray('PATH')} ${colors.underline(destinationPath)}\n` +
    `${colors.gray('URL')} ${fmt.val(url)}\n` +
    `Delete that folder to download it again.`
  )
}

export function remoteSourceDestinationTaken(
  destinationPath: string,
  source: string
) {
  const isUrl = /^https?:\/\//i.test(source)

  return (
    `${getLoggingPrefix('error')} ` +
    (isUrl
      ? `A folder is already here, and it isn't a download from this URL.\n`
      : `A folder is already here, and it wasn't extracted from this ZIP file.\n`) +
    `${colors.gray('PATH')} ${colors.underline(destinationPath)}\n` +
    `${colors.gray(isUrl ? 'URL' : 'ZIP')} ${fmt.val(source)}\n` +
    `Rename or remove that folder, or run the command from another folder.`
  )
}

export function downloadedProjectFolderNotFound(
  cwd: string,
  candidates: string[]
) {
  return (
    `${getLoggingPrefix('error')} Downloaded project folder not found.\n` +
    `${colors.gray('PATH')} ${colors.underline(cwd)}\n` +
    `${colors.gray('NOT FOUND')} ${colors.underline(candidates.join(', '))}`
  )
}

export function packagingSourceFiles(zipPath: string) {
  return `${prefix('debug')} zip      pack=source gitignore=excluded path=${zipPath}`
}

export function zipSkippedSymlinks(links: string[]) {
  return (
    `${getLoggingPrefix('warn')} The source zip skipped ${links.length === 1 ? 'a symlink' : `${links.length} symlinks`}, because an archive stores files.\n` +
    `${colors.gray('SKIPPED')} ${links.join(', ')}\n` +
    `Copy what the link points at into the project if the archive needs it.`
  )
}

export function zipArtifactNotCreated(
  kind: 'source' | 'dist',
  zipPath: string,
  reason: string
) {
  return (
    `${getLoggingPrefix('error')} The ${kind === 'source' ? 'source' : 'distribution'} zip was requested and not created.\n` +
    `${colors.gray('PATH')} ${colors.underline(zipPath)}\n` +
    `${colors.red(reason)}`
  )
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
    `Writing the type definitions for ${manifest.name || 'the extension'}…`
  )
}

export function updatingTypeDefinitions(filePath: string) {
  return (
    `${getLoggingPrefix('info')} ` +
    `Updating the type definitions in ${filePath} to match this version.`
  )
}

export function writingTypeDefinitionsError(error: unknown) {
  return (
    `${getLoggingPrefix('error')} Couldn't write the extension type definitions.\n` +
    `${colors.gray('REASON')} ${colors.red(String(error))}\n` +
    `Check the file permissions, then try again.`
  )
}

export function downloadingText(url: string) {
  return (
    `${getLoggingPrefix('info')} Downloading the browser extension…\n` +
    `${colors.gray('URL')} ${fmt.val(url)}`
  )
}

export function unpackagingExtension(zipFilePath: string) {
  return (
    `${getLoggingPrefix('info')} Unpackaging the browser extension…\n` +
    `${colors.gray('PATH')} ${colors.underline(zipFilePath)}`
  )
}

export function unpackagedSuccessfully() {
  return `${getLoggingPrefix('success')} Extension unpackaged.`
}

// Extraction failures carry their own code and block, so what lands here is
// the download itself or the write of the unpacked files.
export function failedToDownloadOrWriteZIPFileError(error: unknown) {
  return (
    `${getLoggingPrefix('error')} ` +
    `Couldn't download the ZIP file or write it to disk.\n` +
    `${colors.gray('REASON')} ${colors.red(String(error))}\n` +
    `Check the URL, your network and that the destination is writable, then try again.`
  )
}

export function failedToWriteZIPFileError(error: unknown) {
  return (
    `${getLoggingPrefix('error')} ` +
    `Couldn't write the unpacked ZIP file to disk.\n` +
    `${colors.gray('REASON')} ${colors.red(String(error))}\n` +
    `Check that the destination is writable, then try again.`
  )
}

export function invalidRemoteZip(url: string, contentType: string) {
  return (
    `${getLoggingPrefix('error')} ` +
    `The remote URL doesn't point to a ZIP archive.\n` +
    `${colors.gray('URL')} ${colors.underline(url)}\n` +
    `${colors.gray('GOT')} ${colors.underline(contentType || 'unknown')}\n` +
    `Use a direct-download URL, or download the file and pass the local path.`
  )
}

export function notAZipArchive(source: string, contentType?: string) {
  return (
    `${getLoggingPrefix('error')} ` +
    `The downloaded content isn't a ZIP archive.\n` +
    `${colors.gray('SOURCE')} ${colors.underline(source)}\n` +
    (contentType
      ? `${colors.gray('GOT')} ${colors.underline(contentType)}\n`
      : '') +
    `The URL likely requires authentication and returned an HTML login page instead of the file.\n` +
    `This happens with Slack, Google Drive, and Dropbox file pages.\n` +
    `Download the ZIP in the browser and pass the local path, ` +
    `or use a direct-download URL.`
  )
}

// The archive arrived and would not unpack. A cut-short download is fixed by
// fetching again, a bad upload by a good copy passed as a local path.
export function remoteZipDamaged(url: string, cause: unknown) {
  const detail = cause instanceof Error ? cause.message : String(cause)

  return (
    `${getLoggingPrefix('error')} ` +
    `The ZIP archive at the remote URL is damaged.\n` +
    `${colors.gray('URL')} ${colors.underline(url)}\n` +
    `${colors.gray('REASON')} ${colors.red(detail)}\n` +
    `Try again, or download a good copy of the archive and pass the local path.`
  )
}

// A path outside the folder is in the archive itself, so fetching it again
// gets the same refusal and no retry is offered.
export function zipEntryOutsideFolder(
  source: {url: string} | {path: string},
  entry: string
) {
  const where =
    'url' in source ? 'The ZIP archive at the remote URL' : 'The ZIP file'
  const row =
    'url' in source
      ? `${colors.gray('URL')} ${colors.underline(source.url)}`
      : `${colors.gray('PATH')} ${colors.underline(source.path)}`

  return (
    `${getLoggingPrefix('error')} ` +
    `${where} contains a path outside its folder, so it was refused. Nothing was written.\n` +
    `${row}\n` +
    `${colors.gray('ENTRY')} ${colors.red(entry)}\n` +
    `Use an archive whose entries all stay inside its folder.`
  )
}

// A local file has no URL and no login page behind it, so it gets its own
// block and not the one written for a download.
export function localZipUnreadable(zipFilePath: string, cause?: unknown) {
  const detail = cause instanceof Error ? cause.message : String(cause ?? '')

  return (
    `${getLoggingPrefix('error')} ` +
    `The file isn't a ZIP archive that can be unpacked.\n` +
    `${colors.gray('PATH')} ${colors.underline(zipFilePath)}\n` +
    (detail ? `${colors.gray('REASON')} ${colors.red(detail)}\n` : '') +
    `Check that the file opens as a ZIP, then try again.`
  )
}

export function localZipNotFound(zipFilePath: string) {
  return (
    `${getLoggingPrefix('error')} ` +
    `ZIP file not found.\n` +
    `${colors.gray('NOT FOUND')} ${colors.underline(zipFilePath)}\n` +
    `Check the path, then try again.`
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

export function debugSplitChunksNarrowed(optionPaths: string[]) {
  return (
    `${prefix('debug')} chunks   narrowed=${optionPaths.join(',')} ` +
    `single-file=background,content_scripts/,scripts/`
  )
}

export function runtimeChunkKeptInline(runtimeChunk: unknown) {
  const setting =
    typeof runtimeChunk === 'string'
      ? `'${runtimeChunk}'`
      : typeof runtimeChunk === 'object'
        ? 'an object'
        : String(runtimeChunk)

  return (
    `${getLoggingPrefix('warn')} optimization.runtimeChunk is set to ${setting}, kept at false.\n` +
    `The background and the content scripts load one file each, so a separate runtime file never reaches them and the entry never starts. ` +
    `Pages already share code through the shared/ files.`
  )
}

export function configResolvedChangeIgnored(keys: string[]) {
  const many = keys.length > 1

  return (
    `${getLoggingPrefix('warn')} configResolved changed ${keys.join(', ')}, ` +
    `which the hook cannot change. ` +
    `The change is ignored, set ${many ? 'them' : 'it'} in config instead.`
  )
}

export function debugOutputPath(pathValue: string) {
  return `${prefix('debug')} output   path=${pathValue}`
}

export function previewingCustomOutput(
  browser: DevOptions['browser'],
  outputPath: string,
  distPath: string
) {
  return (
    `${getLoggingPrefix('info')} Previewing ${String(browser)} from ${outputPath}.\n` +
    `This is not the build folder ${distPath}. The run record describes the folder loaded.`
  )
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
    `${getLoggingPrefix('warn')} No companion extensions resolved from the ${colors.blue('extensions')} config.\n` +
    `Point each entry at an unpacked extension directory that contains a ` +
    `manifest.json, for example ./extensions/<name>/manifest.json.`
  )
}

// An Error has no enumerable own properties, so stringifying one renders {}
// and loses the single line whose job is to say why the config failed.
function describeThrown(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || 'Error'
  }

  if (typeof error === 'string') return error
  if (error === undefined) return 'undefined'
  if (error === null) return 'null'

  return fmt.truncate(error, 1200)
}

function shapeOf(value: unknown): string {
  if (Array.isArray(value)) return 'an array'
  if (value === null) return 'null'
  if (typeof value === 'function') return 'a function'

  return `a ${typeof value}`
}

export function configWrongShape(configPath: string, value: unknown) {
  const functionHint =
    typeof value === 'function'
      ? `\nTo change the bundler config, export it as ${colors.blue('export default {config: (config) => config}')}.`
      : ''

  return (
    `${getLoggingPrefix('error')} ${colors.blue('extension.config.js')} must export an object, found ${shapeOf(value)}.\n` +
    `${fmt.label('PATH')} ${fmt.val(configPath)}${functionHint}`
  )
}

export function configUnknownKeys(
  configPath: string,
  keys: string[],
  accepted: readonly string[]
) {
  return (
    `${getLoggingPrefix('warn')} ${colors.blue('extension.config.js')} declares ${keys.length === 1 ? 'a key' : 'keys'} nothing reads: ${colors.yellow(keys.join(', '))}.\n` +
    `${fmt.label('PATH')} ${fmt.val(configPath)}\n` +
    `Accepted keys are ${colors.blue(accepted.join(', '))}.`
  )
}

export function configLoadingError(configPath: string, error: unknown) {
  return (
    `${getLoggingPrefix('error')} Couldn't load ${colors.blue('extension.config.js')}.\n` +
    `${fmt.label('PATH')} ${fmt.val(configPath)}\n` +
    `${colors.red(describeThrown(error))}\n` +
    `Fix the config file, then run the command again.`
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

  // A refusal that is already a block becomes the detail of this one.
  const detail = hasChannelPrefix(message)
    ? stripChannelPrefix(message)
    : message

  return (
    `${getLoggingPrefix('error')} Dev mode failed.\n` +
    `${colors.red(fmt.truncate(detail, 1200))}`
  )
}

export function safariInvalidBundleId(bundleId: string) {
  return (
    `${getLoggingPrefix('error')} Can't use ${fmt.code(bundleId)} as a bundle identifier.\n` +
    `Use letters, digits, hyphens and periods, with no empty segment ` +
    `(e.g. ${fmt.code('com.example.my-extension')}).`
  )
}

export function safariBuildOutputNotFound(outputPath: string) {
  return (
    `${getLoggingPrefix('error')} No build output to package for Safari.\n` +
    `${colors.gray('NOT FOUND')} ${colors.underline(outputPath)}\n` +
    `The bundler emitted nothing there, so there is no extension to convert into an app.`
  )
}

export function managedDependencyCopyWarning(
  duplicates: Array<{name: string; shipped: string}>,
  configPath: string
) {
  const list = duplicates
    .map((d) => `- ${colors.yellow(d.name)} (Extension.js ships ${d.shipped})`)
    .join('\n')

  return (
    `${getLoggingPrefix('warn')} ${colors.blue(path.basename(configPath))} loads its own copy of ${duplicates.length === 1 ? 'a package' : 'packages'} Extension.js already ships.\n` +
    `${list}\n` +
    `${fmt.label('PATH')} ${fmt.val(configPath)}\n` +
    `Both copies take part in one build, and when their versions differ the build can break or behave differently.\n` +
    `The build goes on. If it misbehaves, install the version shown or drop the import.`
  )
}
