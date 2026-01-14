// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {rspack, type Configuration} from '@rspack/core'
import {merge} from 'webpack-merge'
import webpackConfig from './webpack-config'
import {getProjectStructure} from './webpack-lib/project'
import * as messages from './webpack-lib/messages'
import {loadCustomWebpackConfig} from './webpack-lib/config-loader'
import {loadCommandConfig, loadBrowserConfig} from './webpack-lib/config-loader'
import {assertNoManagedDependencyConflicts} from './webpack-lib/validate-user-dependencies'
import {
  getDirs,
  computePreviewOutputPath,
  ensureDirSync,
  normalizeBrowser,
  getDistPath
} from './webpack-lib/paths'
import {sanitize} from './webpack-lib/sanitize'
import {handleStatsErrors} from './webpack-lib/stats-handler'
import {createShutdownHandler} from './webpack-lib/shutdown'
import type {PreviewOptions} from './webpack-types'
import {BrowsersPlugin} from './plugin-browsers'

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

  // Only create the directory if we are targeting dist; avoid creating empty folders
  try {
    if (outputPath === distPath) {
      ensureDirSync(outputPath)
    }
  } catch {
    // Ignore
  }

  try {
    // Load command + browser defaults from the project root (package.json dir)
    const commandConfig = await loadCommandConfig(packageJsonDir, 'preview')
    const browserConfig = await loadBrowserConfig(packageJsonDir, browser)

    console.log(messages.previewing(browser))

    const safeBrowserConfig = sanitize(browserConfig)
    const safeCommandConfig = sanitize(commandConfig)
    const safePreviewOptions = sanitize(previewOptions as Record<string, any>)

    const baseConfig: Configuration = webpackConfig(projectStructure, {
      ...safeBrowserConfig,
      ...safeCommandConfig,
      ...safePreviewOptions,
      mode: 'production',
      browser,
      // Normalize Gecko binary hints for engine-based behavior
      geckoBinary:
        safePreviewOptions.geckoBinary || safePreviewOptions.firefoxBinary,
      // For preview, we only want to run the browser with the outputPath.
      output: {
        clean: false,
        path: outputPath
      }
    })

    const onlyBrowserRunners = baseConfig.plugins?.filter(
      (plugin): plugin is BrowsersPlugin => plugin instanceof BrowsersPlugin
    )

    const userExtensionConfig = await loadCustomWebpackConfig(manifestDir)
    const userConfig = userExtensionConfig({
      ...baseConfig,
      plugins: onlyBrowserRunners
    })
    const compilerConfig = merge(userConfig)
    const compiler = rspack(compilerConfig)

    // Fast cancel on Ctrl+C / termination signals: close compiler and exit
    const shutdown = createShutdownHandler(compiler)

    compiler.run((err, stats) => {
      if (err) {
        console.error(err.stack || err)
        shutdown(1)
      }

      if (stats?.hasErrors()) {
        handleStatsErrors(stats)
        shutdown(1)
      }
    })
  } catch (error) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.error(error)
    }
    process.exit(1)
  }
}
