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
import webpackConfig from '../webpack/webpack-config'
import {getProjectStructure} from './commands-lib/get-project-path'
import * as messages from './commands-lib/messages'
import {loadCustomWebpackConfig} from './commands-lib/get-extension-config'
import {PreviewOptions} from './commands-lib/config-types'
import {assertNoManagedDependencyConflicts} from './commands-lib/validate-user-dependencies'
import {BrowsersPlugin} from '../plugin-browsers'

export async function extensionPreview(
  pathOrRemoteUrl: string | undefined,
  previewOptions: PreviewOptions
) {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)
  // Guard: only error if user references managed deps in extension.config.js
  assertNoManagedDependencyConflicts(
    projectStructure.packageJsonPath,
    path.dirname(projectStructure.manifestPath)
  )
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
      // Preview needs a build before running so
      // we don't want to clean the output directory.
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
