// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as devServerMessages from './dev-server/messages'
import {
  loadBrowserConfig,
  loadCommandConfig,
  loadProjectConfigDefaults
} from './lib/config-loader'
import {withDarkMode} from './lib/dark-mode'
import {computeExtensionsToLoad} from './lib/extensions-to-load'
import {mergeOptionLayers, SERVE_COMMAND_DEFAULTS} from './lib/merge-options'
import * as messages from './lib/messages'
import {humanLine, isDebug} from './lib/messaging'
import {
  computePreviewOutputPath,
  getDirs,
  getDistPath,
  normalizeBrowser
} from './lib/paths'
import {getProjectStructure} from './lib/project'
import {sanitize} from './lib/sanitize'
import {assertNoManagedDependencyConflicts} from './lib/validate-user-dependencies'
import {
  createPlaywrightMetadataWriter,
  getSessionRunId
} from './plugin-playwright'
import {resolveCompanionExtensionsConfig} from './plugin-special-folders/folder-extensions/resolve-config'
import {resolveCompanionExtensionDirs as resolveCompanionExtensionDirsFromSpecialFolders} from './plugin-special-folders/folder-extensions/resolve-dirs'
import type {CompanionExtensionsConfig} from './plugin-special-folders/folder-extensions/types'
import {getSpecialFoldersDataForProjectRoot} from './plugin-special-folders/get-data'
import type {BrowserConfig, PreviewOptions} from './types'

/**
 * Resolved browser launch options returned by extensionPreview.
 * The caller is responsible for actually launching the browser.
 */
export interface ResolvedPreviewOptions {
  browser: string
  outPath: string
  contextDir: string
  readyPath: string
  extensionsToLoad: string[]
  noOpen?: boolean
  profile?: string | false
  persistProfile?: boolean
  preferences?: Record<string, unknown>
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  startingUrl?: string
  chromiumBinary?: string
  geckoBinary?: string
  instanceId?: string
  port?: number | string
  dryRun?: boolean
  logLevel?: string
  logContexts?: string[]
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: number | string
}

/**
 * Browser launcher callback. When provided, extensionPreview calls it
 * instead of requiring plugin-browsers internally.
 */
export type PreviewLauncherFn = (opts: ResolvedPreviewOptions) => Promise<void>

function readRunIdFromReadyFile(readyPath: string): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    return typeof parsed?.runId === 'string' ? parsed.runId : undefined
  } catch {
    return undefined
  }
}

export async function extensionPreview(
  pathOrRemoteUrl: string | undefined,
  previewOptions: PreviewOptions,
  browserLauncher?: PreviewLauncherFn
) {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)
  const debug = isDebug()
  const {manifestDir, packageJsonDir} = getDirs(projectStructure)

  const userManifestPath =
    projectStructure.packageJsonPath || projectStructure.denoJsonPath
  if (userManifestPath) {
    assertNoManagedDependencyConflicts(userManifestPath, packageJsonDir)
  }
  const browser = normalizeBrowser(
    previewOptions.browser || 'chrome',
    previewOptions.chromiumBinary,
    previewOptions.geckoBinary || previewOptions.firefoxBinary
  )
  const outputPath = computePreviewOutputPath(
    projectStructure,
    browser,
    previewOptions.outputPath
  )
  const distPath = getDistPath(packageJsonDir, browser)
  const metadataCommand =
    previewOptions.metadataCommand === 'start' ? 'start' : 'preview'
  const runningMessage =
    metadataCommand === 'start' ? messages.starting : messages.previewing
  const metadata = createPlaywrightMetadataWriter({
    packageJsonDir,
    browser: String(browser),
    command: metadataCommand,
    distPath,
    manifestPath: projectStructure.manifestPath,
    port:
      typeof previewOptions.port === 'number'
        ? previewOptions.port
        : typeof previewOptions.port === 'string'
          ? parseInt(previewOptions.port, 10)
          : null
  })

  // `extension start` already opened this run in the build phase (timeline
  // rows + compile stamp). A second writeStarting would wipe the rows and
  // restamp compiledAt as "browser came up". Continue only when the ready
  // file carries THIS process's runId: a stale file from an earlier run
  // must not poison the new run's timeline or refusal status.
  const continuingStartRun =
    metadataCommand === 'start' &&
    readRunIdFromReadyFile(metadata.readyPath) ===
      getSessionRunId(packageJsonDir, String(browser))
  if (!continuingStartRun) {
    metadata.writeStarting()
  }

  if (debug) {
    humanLine(messages.debugDirs(manifestDir, packageJsonDir))
    humanLine(
      messages.debugBrowser(
        browser,
        previewOptions.chromiumBinary,
        previewOptions.geckoBinary || previewOptions.firefoxBinary
      )
    )
    humanLine(messages.debugPreviewOutput(outputPath, distPath))
  }

  // Run-only preview requires an existing unpacked extension root at outputPath.
  // If dist/<browser> doesn't exist, computePreviewOutputPath falls back to manifestDir.
  const manifestAtOutput = path.join(outputPath, 'manifest.json')
  if (!fs.existsSync(manifestAtOutput)) {
    metadata.writeError(
      'preview_manifest_missing',
      `Expected manifest at ${manifestAtOutput}`
    )

    throw new Error(
      `Preview is run-only and does not compile.\n` +
        `Expected an unpacked extension at:\n` +
        `  ${manifestAtOutput}\n\n` +
        `Run \`extension build\` or \`extension dev\` first, or pass --output-path to an existing unpacked extension directory.`
    )
  }

  // Load command + browser defaults from the project root; when start.ts
  // delegates here, honor commands.start.* rather than commands.preview.*.
  const projectConfig = await loadProjectConfigDefaults(packageJsonDir)
  const commandConfig = await loadCommandConfig(packageJsonDir, metadataCommand)
  const browserConfig = await loadBrowserConfig(packageJsonDir, browser)

  if (previewOptions.noBrowser) {
    const browserLabel = String(browser || 'unknown')
    // Identity first, then the state lines: the card is the header for the
    // session, not a summary trailing the result it describes.
    humanLine(devServerMessages.spacerLine())
    humanLine(
      devServerMessages.browserRunnerDisabled({
        browser: browserLabel,
        manifestPath: projectStructure.manifestPath,
        readyPath: metadata.readyPath,
        distPath: outputPath
      })
    )
    humanLine(devServerMessages.spacerLine())
    humanLine(runningMessage(browser, true))
    metadata.writeReady()
    return
  }

  humanLine(runningMessage(browser))

  if (
    !previewOptions.outputPath &&
    path.resolve(outputPath) !== path.resolve(distPath)
  ) {
    humanLine(messages.previewingSourceFallback(browser, distPath))
  }

  const safeProjectConfig = sanitize(projectConfig) as {
    extensions?: CompanionExtensionsConfig
  }
  const safeBrowserConfig = sanitize(browserConfig) as BrowserConfig
  const safeCommandConfig = sanitize(
    commandConfig
  ) as Partial<PreviewOptions> & {
    extensions?: CompanionExtensionsConfig
  }
  const safePreviewOptions = sanitize(previewOptions) as PreviewOptions
  const specialFoldersData = getSpecialFoldersDataForProjectRoot(packageJsonDir)

  const mergedExtensionsConfig =
    safePreviewOptions.extensions ??
    safeCommandConfig.extensions ??
    safeBrowserConfig.extensions ??
    safeProjectConfig.extensions ??
    specialFoldersData.extensions
  const resolvedExtensionsConfig = await resolveCompanionExtensionsConfig({
    projectRoot: packageJsonDir,
    browser,
    config: mergedExtensionsConfig
  })

  const mergedGeckoBinary =
    safePreviewOptions.geckoBinary ||
    safePreviewOptions.firefoxBinary ||
    safeCommandConfig.geckoBinary ||
    safeCommandConfig.firefoxBinary ||
    safeBrowserConfig.geckoBinary ||
    safeBrowserConfig.firefoxBinary

  const mergedChromiumBinary =
    safePreviewOptions.chromiumBinary ||
    safeCommandConfig.chromiumBinary ||
    safeBrowserConfig.chromiumBinary

  // stock defaults, then top-level config, then browser.*, then
  // commands.start|preview, then CLI. Unset CLI keys fall through so shared
  // extension.config.js values apply.
  const merged: PreviewOptions &
    BrowserConfig & {
      extensions?: CompanionExtensionsConfig
      instanceId?: string
      dryRun?: boolean
    } = {
    ...mergeOptionLayers<PreviewOptions & BrowserConfig>(
      SERVE_COMMAND_DEFAULTS,
      safeProjectConfig,
      safeBrowserConfig,
      safeCommandConfig,
      safePreviewOptions
    ),
    extensions: resolvedExtensionsConfig,
    chromiumBinary: mergedChromiumBinary,
    geckoBinary: mergedGeckoBinary
  }

  const darkDefaults = withDarkMode({
    browser,
    browserFlags: merged.browserFlags,
    preferences: merged.preferences,
    excludeBrowserFlags: merged.excludeBrowserFlags
  })

  const companionUnpackedExtensionDirs =
    resolveCompanionExtensionDirsFromSpecialFolders({
      projectRoot: packageJsonDir,
      config: merged.extensions
    })

  const unpackedExtensionDirsToLoad = computeExtensionsToLoad(
    // __dirname changes after publishing; anchor relative paths at the package
    // root so companion extensions stay stable across monorepo + published builds.
    path.resolve(__dirname, '..'),
    'production',
    browser,
    outputPath,
    companionUnpackedExtensionDirs,
    projectStructure.manifestPath
  )

  metadata.setManagedExtensionDirs(
    unpackedExtensionDirsToLoad.filter(
      (dir) => path.resolve(dir) !== path.resolve(outputPath)
    )
  )

  const resolvedOpts: ResolvedPreviewOptions = {
    browser,
    outPath: outputPath,
    contextDir: packageJsonDir,
    readyPath: metadata.readyPath,
    extensionsToLoad: unpackedExtensionDirsToLoad,
    noOpen: merged.noOpen,
    profile: merged.profile,
    persistProfile: merged.persistProfile,
    preferences: darkDefaults.preferences,
    browserFlags: darkDefaults.browserFlags,
    excludeBrowserFlags: merged.excludeBrowserFlags,
    startingUrl: merged.startingUrl,
    chromiumBinary: merged.chromiumBinary,
    geckoBinary: merged.geckoBinary,
    instanceId: merged.instanceId,
    port: merged.port,
    dryRun: merged.dryRun,
    logLevel: merged.logLevel,
    logContexts: merged.logContexts,
    logFormat: merged.logFormat,
    logTimestamps: merged.logTimestamps,
    logColor: merged.logColor,
    logUrl: merged.logUrl,
    logTab: merged.logTab
  }

  if (!browserLauncher) {
    throw new Error(
      'extensionPreview requires a browserLauncher callback. ' +
        'The browser launch code has moved to programs/extension/browsers/.'
    )
  }

  await browserLauncher(resolvedOpts)

  metadata.writeReady()
}
