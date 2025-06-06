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
import {
  getProjectPath,
  getProjectOutputPath
} from './commands-lib/get-project-path'
import * as messages from './commands-lib/messages'
import {loadCustomWebpackConfig} from './commands-lib/get-extension-config'
import {PreviewOptions} from './commands-lib/config-types'

export async function extensionPreview(
  pathOrRemoteUrl: string | undefined,
  previewOptions: PreviewOptions
) {
  const projectPath = await getProjectPath(pathOrRemoteUrl)

  if (
    !pathOrRemoteUrl?.startsWith('http') &&
    !fs.existsSync(path.join(projectPath, 'manifest.json'))
  ) {
    console.log(
      messages.manifestNotFoundError(path.join(projectPath, 'manifest.json'))
    )
    process.exit(1)
  }

  try {
    const browser = previewOptions.browser || 'chrome'
    const baseConfig: Configuration = webpackConfig(projectPath, {
      mode: 'production',
      profile: previewOptions.profile,
      browser,
      chromiumBinary: previewOptions.chromiumBinary,
      geckoBinary: previewOptions.geckoBinary,
      startingUrl: previewOptions.startingUrl,
      // Preview needs a build before running so
      // we don't want to clean the output directory.
      output: {
        clean: false
      }
    })

    const contextPath = getProjectOutputPath(projectPath, browser)
    const onlyBrowserRunners = baseConfig.plugins?.filter((plugin) => {
      return plugin?.constructor.name === 'plugin-browsers'
    })

    const userExtensionConfig = await loadCustomWebpackConfig(contextPath)
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
        console.log(messages.runningInProduction(contextPath))
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
