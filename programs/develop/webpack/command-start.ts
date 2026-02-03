// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {getProjectStructure} from './webpack-lib/project'
import {extensionBuild} from './command-build'
import {extensionPreview} from './command-preview'
import * as messages from './webpack-lib/messages'
import {getDirs, getDistPath, normalizeBrowser} from './webpack-lib/paths'
import {loadCommandConfig, loadBrowserConfig} from './webpack-lib/config-loader'
import {ensureProjectReady} from './webpack-lib/dependency-manager'
import type {StartOptions} from './webpack-types'

export async function extensionStart(
  pathOrRemoteUrl: string | undefined,
  startOptions: StartOptions
) {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)

  try {
    const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
    const debug = isAuthor
    const shouldInstallProjectDeps = !isAuthor || startOptions.install !== false

    const previousOneTimeHint = process.env.EXTENSION_ONE_TIME_INSTALL_HINT
    process.env.EXTENSION_ONE_TIME_INSTALL_HINT = 'true'
    try {
      await ensureProjectReady(projectStructure, 'development', {
        skipProjectInstall:
          !projectStructure.packageJsonPath || !shouldInstallProjectDeps,
        exitOnInstall: false,
        showRunAgainMessage: false
      })
    } finally {
      if (previousOneTimeHint === undefined) {
        delete process.env.EXTENSION_ONE_TIME_INSTALL_HINT
      } else {
        process.env.EXTENSION_ONE_TIME_INSTALL_HINT = previousOneTimeHint
      }
    }

    const browser = normalizeBrowser(
      startOptions.browser || 'chrome',
      startOptions.chromiumBinary,
      startOptions.geckoBinary || startOptions.firefoxBinary
    )
    const {manifestDir, packageJsonDir} = getDirs(projectStructure)
    const commandConfig = await loadCommandConfig(packageJsonDir, 'start')
    const browserConfig = await loadBrowserConfig(packageJsonDir, browser)

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
