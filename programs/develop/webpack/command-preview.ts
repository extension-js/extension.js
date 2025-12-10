// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

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
import {scrubBrand} from './webpack-lib/branding'
import {
  getDirs,
  computePreviewOutputPath,
  ensureDirSync,
  normalizeBrowser,
  getDistPath
} from './webpack-lib/paths'
import type {PreviewOptions} from './webpack-types'
import {BrowsersPlugin} from './plugin-browsers'
import chromiumLocation from 'chromium-location'
import * as chromeLocation from 'chrome-location2'
import edgeLocation from 'edge-location'
import firefoxLocation from 'firefox-location2'

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

  // Helper to avoid overriding file-config values with undefined from CLI/options
  const sanitize = <T extends Record<string, any>>(obj: T): Partial<T> =>
    Object.fromEntries(
      Object.entries(obj || {}).filter(([, v]) => typeof v !== 'undefined')
    ) as Partial<T>

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
    let isShuttingDown = false
    const shutdown = (code = 0) => {
      if (isShuttingDown) return
      isShuttingDown = true

      try {
        compiler.close(() => {
          process.exit(code)
        })

        // Safety net in case close callback never fires
        setTimeout(() => process.exit(code), 2000)
      } catch {
        process.exit(code)
      }
    }

    process.on('SIGINT', () => shutdown(0))
    process.on('SIGTERM', () => shutdown(0))
    process.on('SIGHUP', () => shutdown(0))

    compiler.run((err, stats) => {
      if (err) {
        console.error(err.stack || err)
        shutdown(1)
      }

      if (stats?.hasErrors()) {
        try {
          const verbose =
            String(process.env.EXTENSION_VERBOSE || '').trim() === '1'
          const str = stats?.toString?.({
            colors: true,
            all: false,
            errors: true,
            warnings: !!verbose
          })

          if (str) console.error(scrubBrand(str))
        } catch {
          try {
            const str = stats?.toString?.({
              colors: true,
              all: false,
              errors: true,
              warnings: true
            })
            if (str) console.error(str)
          } catch {
            // Ignore
          }
        }
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
