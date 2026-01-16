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
    const debug = process.env.EXTENSION_AUTHOR_MODE === 'true'
    const {manifestDir, packageJsonDir} = getDirs(projectStructure)
    const depsResult = await ensureProjectReady(
      projectStructure,
      'development',
      {
        skipProjectInstall: !projectStructure.packageJsonPath,
        exitOnInstall: true
      }
    )

    if (depsResult.installed) return

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
