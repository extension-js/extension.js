// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {generateExtensionTypes} from './webpack-lib/generate-extension-types'
import {getProjectStructure} from './webpack-lib/project'
import {installDependencies} from './webpack-lib/install-dependencies'
import {assertNoManagedDependencyConflicts} from './webpack-lib/validate-user-dependencies'
import {getDirs, needsInstall, normalizeBrowser} from './webpack-lib/paths'
import * as messages from './webpack-lib/messages'
import {
  areBuildDependenciesInstalled,
  getMissingBuildDependencies,
  findExtensionDevelopRoot
} from './webpack-lib/check-build-dependencies'
import {installOwnDependencies} from './webpack-lib/install-own-dependencies'
import type {DevOptions} from './webpack-types'

// TODO cezaraugusto: move this out
import {isUsingTypeScript} from './plugin-js-frameworks/js-tools/typescript'

export async function extensionDev(
  pathOrRemoteUrl: string | undefined,
  devOptions: DevOptions
) {
  // Check and install build dependencies if needed
  const packageRoot = findExtensionDevelopRoot()
  if (packageRoot && !areBuildDependenciesInstalled(packageRoot)) {
    const missing = getMissingBuildDependencies(packageRoot)
    await installOwnDependencies(missing, packageRoot)
  }

  const projectStructure = await getProjectStructure(pathOrRemoteUrl)

  try {
    const debug = process.env.EXTENSION_AUTHOR_MODE === 'true'
    const {manifestDir, packageJsonDir} = getDirs(projectStructure)

    if (isUsingTypeScript(manifestDir)) {
      await generateExtensionTypes(manifestDir, packageJsonDir)
    }

    if (projectStructure.packageJsonPath) {
      assertNoManagedDependencyConflicts(
        projectStructure.packageJsonPath,
        manifestDir
      )
    }

    // Install dependencies if they are not installed (skip in web-only mode).
    if (projectStructure.packageJsonPath) {
      if (needsInstall(packageJsonDir)) {
        console.log(messages.installingDependencies())
        await installDependencies(packageJsonDir)
      }
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
