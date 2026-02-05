// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as messages from './webpack-lib/messages'
import {generateExtensionTypes} from './webpack-lib/generate-extension-types'
import {getProjectStructure} from './webpack-lib/project'
import {assertNoManagedDependencyConflicts} from './webpack-lib/validate-user-dependencies'
import {getDirs, normalizeBrowser} from './webpack-lib/paths'
import {ensureProjectReady} from './webpack-lib/dependency-manager'
import type {DevOptions} from './webpack-types'

// TODO cezaraugusto: move this out
import {isUsingTypeScript} from './plugin-js-frameworks/js-tools/typescript'

export async function extensionDev(
  pathOrRemoteUrl: string | undefined,
  devOptions: DevOptions
) {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)

  try {
    const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
    const debug = isAuthor
    const {manifestDir, packageJsonDir} = getDirs(projectStructure)
    const shouldInstallProjectDeps = !isAuthor || devOptions.install !== false

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

    if (isUsingTypeScript(manifestDir)) {
      await generateExtensionTypes(manifestDir, packageJsonDir)
    }

    if (projectStructure.packageJsonPath) {
      assertNoManagedDependencyConflicts(
        projectStructure.packageJsonPath,
        manifestDir
      )
    }

    const browser = normalizeBrowser(
      devOptions.browser || 'chrome',
      devOptions.chromiumBinary,
      devOptions.geckoBinary || devOptions.firefoxBinary
    )
    const geckoBinary = devOptions.geckoBinary || devOptions.firefoxBinary

    if (debug) {
      console.log(messages.debugDirs(manifestDir, packageJsonDir))
      console.log(
        messages.debugBrowser(browser, devOptions.chromiumBinary, geckoBinary)
      )
    }

    if (process.env.EXTENSION_DEV_DRY_RUN === 'true') {
      return
    }

    // Heavy deps are imported lazily so preview can stay minimal.
    const {devServer} = await import('./dev-server')

    await devServer(projectStructure, {
      ...devOptions,
      mode: 'development',
      browser,
      geckoBinary
    })
  } catch (error) {
    // Always surface a minimal error so users aren't left with a silent exit
    console.error(error)
    process.exit(1)
  }
}
