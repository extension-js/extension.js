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
import webpackConfig from './webpack/webpack-config'
import {getProjectStructure} from './develop-lib/get-project-path'
import * as messages from './develop-lib/messages'
import {loadCustomWebpackConfig} from './develop-lib/get-extension-config'
import {PreviewOptions} from './types/options'
import {assertNoManagedDependencyConflicts} from './develop-lib/validate-user-dependencies'
import {BrowsersPlugin} from './webpack/plugin-browsers'

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
  const distPath = path.join(manifestDir, 'dist', previewOptions.browser)

  // Output path defaults to extensionPreview config.
  // The start command will use the build directory.
  // The preview command will use the build directory if it exists,
  // otherwise it will use the project path.
  // This is useful for remote packages that don't have a build directory.
  // but are ready for manual browser testing.
  const outputPath = previewOptions.outputPath
    ? previewOptions.outputPath
    : fs.existsSync(distPath)
      ? distPath
      : manifestDir

  try {
    const browser = previewOptions.browser || 'chrome'

    console.log(messages.previewing(browser))

    const baseConfig: Configuration = webpackConfig(projectStructure, {
      mode: 'production',
      profile: previewOptions.profile,
      browser,
      chromiumBinary: previewOptions.chromiumBinary,
      geckoBinary: previewOptions.geckoBinary,
      startingUrl: previewOptions.startingUrl,
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

    compiler.run((err, stats) => {
      if (err) {
        console.error(err.stack || err)
        process.exit(1)
      }

      if (!stats?.hasErrors()) {
        console.log(messages.runningInProduction(manifestDir))
      } else {
        console.log(stats.toString({colors: true}))
        process.exit(1)
      }
    })
  } catch (error) {
    if (process.env.EXTENSION_ENV === 'development') {
      console.error(error)
    }
    process.exit(1)
  }
}
