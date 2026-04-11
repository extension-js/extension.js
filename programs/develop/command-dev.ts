// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as messages from './lib/messages'
import {generateExtensionTypes} from './lib/generate-extension-types'
import {getProjectStructure} from './lib/project'
import {assertNoManagedDependencyConflicts} from './lib/validate-user-dependencies'
import {getDirs, normalizeBrowser} from './lib/paths'
import {
  ensureDevelopArtifacts,
  ensureUserProjectDependencies
} from './lib/ensure-develop-artifacts'
import {
  BrowsersPlugin,
  BuildEmitter,
  type BrowserLauncherFn
} from './plugin-browsers'
import type {DevOptions} from './types'

// TODO cezaraugusto: move this out
import {isUsingTypeScript} from './plugin-js-frameworks/js-tools/typescript'

export async function extensionDev(
  pathOrRemoteUrl: string | undefined,
  devOptions: DevOptions & {launcher?: BrowserLauncherFn}
): Promise<BuildEmitter> {
  // When a launcher is provided, create the BrowsersPlugin that wraps the
  // browser API behind rspack hooks. Otherwise fall back to a plain emitter
  // for no-browser / dry-run modes.
  let browsersPlugin: BrowsersPlugin | undefined
  let emitter: BuildEmitter

  if (devOptions.launcher && !devOptions.noBrowser) {
    browsersPlugin = new BrowsersPlugin({
      launcher: devOptions.launcher,
      browserOptions: {
        browser: devOptions.browser,
        mode: 'development',
        enableDevtools: true,
        noOpen: devOptions.noOpen,
        profile: devOptions.profile,
        persistProfile: devOptions.persistProfile,
        preferences: devOptions.preferences,
        browserFlags: devOptions.browserFlags,
        startingUrl: devOptions.startingUrl,
        chromiumBinary: devOptions.chromiumBinary,
        geckoBinary: devOptions.geckoBinary || devOptions.firefoxBinary,
        port: devOptions.port,
        source: devOptions.source,
        watchSource: devOptions.watchSource,
        sourceFormat: devOptions.sourceFormat,
        sourceSummary: devOptions.sourceSummary,
        sourceMeta: devOptions.sourceMeta,
        sourceProbe: devOptions.sourceProbe,
        sourceTree: devOptions.sourceTree,
        sourceConsole: devOptions.sourceConsole,
        sourceDom: devOptions.sourceDom,
        sourceMaxBytes: devOptions.sourceMaxBytes,
        sourceRedact: devOptions.sourceRedact,
        sourceIncludeShadow: devOptions.sourceIncludeShadow,
        sourceDiff: devOptions.sourceDiff,
        logLevel: devOptions.logLevel,
        logContexts: devOptions.logContexts,
        logFormat: devOptions.logFormat,
        logTimestamps: devOptions.logTimestamps,
        logColor: devOptions.logColor,
        logUrl: devOptions.logUrl,
        logTab: devOptions.logTab
      }
    })
    emitter = browsersPlugin.emitter
  } else {
    emitter = new BuildEmitter()
  }

  const projectStructure = await getProjectStructure(pathOrRemoteUrl)

  try {
    const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
    const debug = isAuthor
    const {manifestDir, packageJsonDir} = getDirs(projectStructure)

    await ensureDevelopArtifacts()
    await ensureUserProjectDependencies(packageJsonDir)

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
      return emitter
    }

    // Heavy deps are imported lazily so preview can stay minimal.
    const {devServer} = await import('./dev-server')

    await devServer(projectStructure, {
      ...devOptions,
      mode: 'development',
      browser,
      geckoBinary,
      browsersPlugin
    } as any)

    return emitter
  } catch (error) {
    // Always surface a minimal error so users aren't left with a silent exit
    console.error(error)
    process.exit(1)
  }

  return emitter
}
