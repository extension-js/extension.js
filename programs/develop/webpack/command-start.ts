// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import {getProjectStructure} from './webpack-lib/project'
import {extensionBuild} from './command-build'
import {extensionPreview} from './command-preview'
import {getDirs, getDistPath, normalizeBrowser} from './webpack-lib/paths'
import * as messages from './webpack-lib/messages'
import {loadCommandConfig, loadBrowserConfig} from './webpack-lib/config-loader'
import type {StartOptions} from './webpack-types'

export async function extensionStart(
  pathOrRemoteUrl: string | undefined,
  startOptions: StartOptions
) {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)

  try {
    const debug = process.env.EXTENSION_AUTHOR_MODE === 'true'
    const browser = normalizeBrowser(
      startOptions.browser || 'chrome',
      startOptions.chromiumBinary,
      startOptions.geckoBinary || startOptions.firefoxBinary
    )
    const {manifestDir, packageJsonDir} = getDirs(projectStructure)
    const commandConfig = await loadCommandConfig(manifestDir, 'start')
    const browserConfig = await loadBrowserConfig(manifestDir, browser)

    const distPath = getDistPath(packageJsonDir, browser)
    if (debug) {
      console.log(messages.debugDirs(manifestDir, packageJsonDir))
      console.log(
        messages.debugBrowser(
          browser,
          startOptions.chromiumBinary,
          startOptions.geckoBinary || startOptions.firefoxBinary
        )
      )
      console.log(messages.debugOutputPath(distPath))
    }

    await extensionBuild(pathOrRemoteUrl, {
      ...browserConfig,
      ...commandConfig,
      ...startOptions,
      browser,
      silent: true
    })

    await extensionPreview(pathOrRemoteUrl, {
      ...browserConfig,
      ...commandConfig,
      ...startOptions,
      browser,
      geckoBinary: startOptions.geckoBinary || startOptions.firefoxBinary,
      // Starts preview the extension from the build directory
      outputPath: distPath
    })
  } catch (error) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.error(error)
    }
    process.exit(1)
  }
}
