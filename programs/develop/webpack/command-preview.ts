// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {getProjectStructure} from './webpack-lib/project'
import * as messages from './webpack-lib/messages'
import {loadCommandConfig, loadBrowserConfig} from './webpack-lib/config-loader'
import {assertNoManagedDependencyConflicts} from './webpack-lib/validate-user-dependencies'
import {
  getDirs,
  computePreviewOutputPath,
  normalizeBrowser,
  getDistPath
} from './webpack-lib/paths'
import {sanitize} from './webpack-lib/sanitize'
import type {BrowserConfig, PreviewOptions} from './webpack-types'
import {resolveCompanionExtensionsConfig} from './feature-special-folders/folder-extensions/resolve-config'
import {resolveCompanionExtensionDirs as resolveCompanionExtensionDirsFromSpecialFolders} from './feature-special-folders/folder-extensions/resolve-dirs'
import {type CompanionExtensionsConfig} from './feature-special-folders/folder-extensions/types'
import {getSpecialFoldersDataForProjectRoot} from './feature-special-folders/get-data'
import {computeExtensionsToLoad} from './webpack-lib/extensions-to-load'
import {withDarkMode} from './webpack-lib/dark-mode'
import {runOnlyPreviewBrowser} from './plugin-browsers/run-only'

export async function extensionPreview(
  pathOrRemoteUrl: string | undefined,
  previewOptions: PreviewOptions
) {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)
  const debug = process.env.EXTENSION_AUTHOR_MODE === 'true'

  // Guard: only error if user references managed deps in extension.config.js
  if (projectStructure.packageJsonPath) {
    assertNoManagedDependencyConflicts(
      projectStructure.packageJsonPath,
      path.dirname(projectStructure.manifestPath)
    )
  }

  const {manifestDir, packageJsonDir} = getDirs(projectStructure)
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

  if (debug) {
    console.log(messages.debugDirs(manifestDir, packageJsonDir))
    console.log(
      messages.debugBrowser(
        browser,
        previewOptions.chromiumBinary,
        previewOptions.geckoBinary || previewOptions.firefoxBinary
      )
    )
    console.log(messages.debugPreviewOutput(outputPath, distPath))
  }

  // Run-only preview requires an existing unpacked extension root at outputPath.
  // If dist/<browser> doesn't exist, computePreviewOutputPath falls back to manifestDir.
  const manifestAtOutput = path.join(outputPath, 'manifest.json')
  if (!fs.existsSync(manifestAtOutput)) {
    throw new Error(
      `Preview is run-only and does not compile.\n` +
        `Expected an unpacked extension at:\n` +
        `  ${manifestAtOutput}\n\n` +
        `Run \`extension build\` or \`extension dev\` first, or pass --output-path to an existing unpacked extension directory.`
    )
  }

  // Load command + browser defaults from the project root (package.json dir)
  const commandConfig = await loadCommandConfig(packageJsonDir, 'preview')
  const browserConfig = await loadBrowserConfig(packageJsonDir, browser)

  console.log(messages.previewing(browser))

  if (previewOptions.noRunner) {
    console.log(messages.previewSkippedNoRunner(browser))
    return
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

  const merged: PreviewOptions &
    BrowserConfig & {
      extensions?: CompanionExtensionsConfig
      instanceId?: string
      dryRun?: boolean
    } = {
    ...safeBrowserConfig,
    ...safeCommandConfig,
    ...safePreviewOptions,
    extensions: resolvedExtensionsConfig,
    chromiumBinary: mergedChromiumBinary,
    // Normalize Gecko binary hints for engine-based behavior
    geckoBinary: mergedGeckoBinary
  }

  const darkDefaults = withDarkMode({
    browser,
    browserFlags: merged.browserFlags,
    preferences: merged.preferences
  })

  const companionUnpackedExtensionDirs =
    resolveCompanionExtensionDirsFromSpecialFolders({
      projectRoot: packageJsonDir,
      config: merged.extensions
    })

  const unpackedExtensionDirsToLoad = computeExtensionsToLoad(
    // IMPORTANT: __dirname changes after publishing (compiled output lives in dist/).
    // Always anchor relative paths at the @programs/develop package root to keep
    // companion extensions (devtools/theme) stable across monorepo + published builds.
    path.resolve(__dirname, '..'),
    'production',
    browser,
    outputPath,
    companionUnpackedExtensionDirs,
    projectStructure.manifestPath
  )

  await runOnlyPreviewBrowser({
    browser,
    outPath: outputPath,
    contextDir: packageJsonDir,
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
    dryRun: merged.dryRun
  })
}
