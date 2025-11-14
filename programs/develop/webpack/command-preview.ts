// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as fs from 'fs'
import * as path from 'path'
import {rspack, type Configuration} from '@rspack/core'
import {merge} from 'webpack-merge'
import webpackConfig from './webpack-config'
import {getProjectStructure} from './webpack-lib/project'
import * as messages from './webpack-lib/messages'
import {loadCustomWebpackConfig} from './webpack-lib/config-loader'
import {loadCommandConfig, loadBrowserConfig} from './webpack-lib/config-loader'
import {assertNoManagedDependencyConflicts} from './webpack-lib/validate-user-dependencies'
import {BrowsersPlugin} from './plugin-browsers'
import type {PreviewOptions} from './webpack-types'
import {scrubBrand} from './webpack-lib/branding'

export async function extensionPreview(
  pathOrRemoteUrl: string | undefined,
  previewOptions: PreviewOptions
) {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)
  // Guard: only error if user references managed deps in extension.config.js
  if (projectStructure.packageJsonPath) {
    assertNoManagedDependencyConflicts(
      projectStructure.packageJsonPath,
      path.dirname(projectStructure.manifestPath)
    )
  }

  const manifestDir = path.dirname(projectStructure.manifestPath)
  const packageJsonDir = projectStructure.packageJsonPath
    ? path.dirname(projectStructure.packageJsonPath)
    : manifestDir
  const distPath = path.join(packageJsonDir, 'dist', previewOptions.browser)

  // Output path defaults to extensionPreview config.
  // The start command will use the build directory.
  // The preview command will use the build directory if it exists,
  // otherwise it will use the project path.
  // This is useful for remote packages that don't have a build directory.
  // but are ready for manual browser testing.
  // Enforce parity: always preview from dist/<browser> and create it if missing
  const outputPath = previewOptions.outputPath || distPath

  try {
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, {recursive: true})
    }
  } catch {
    // Ignore
  }

  try {
    const browser = previewOptions.browser || 'chrome'

    const commandConfig = await loadCommandConfig(manifestDir, 'preview')
    const browserConfig = await loadBrowserConfig(manifestDir, browser)

    console.log(messages.previewing(browser))

    const baseConfig: Configuration = webpackConfig(projectStructure, {
      ...browserConfig,
      ...commandConfig,
      mode: 'production',
      profile: previewOptions.profile,
      browser,
      chromiumBinary: previewOptions.chromiumBinary,
      geckoBinary: previewOptions.geckoBinary,
      startingUrl: previewOptions.startingUrl,
      port: previewOptions.port,
      source: previewOptions.source,
      watchSource: previewOptions.watchSource,
      logLevel: previewOptions.logLevel,
      logContexts: previewOptions.logContexts,
      logFormat: previewOptions.logFormat,
      logTimestamps: previewOptions.logTimestamps,
      logColor: previewOptions.logColor,
      logUrl: previewOptions.logUrl,
      logTab: previewOptions.logTab,
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

      if (!stats?.hasErrors()) {
        console.log('')
        console.log(messages.runningInProduction(manifestDir))
      } else {
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
    if (process.env.EXTENSION_ENV === 'development') {
      console.error(error)
    }
    process.exit(1)
  }
}
