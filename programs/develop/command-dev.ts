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
import {loadBrowserConfig, loadCommandConfig} from './lib/config-loader'
import {sanitize} from './lib/sanitize'
import {
  ensureDevelopArtifacts,
  ensureUserProjectDependencies
} from './lib/ensure-develop-artifacts'
import {
  BrowsersPlugin,
  BuildEmitter,
  type BrowserLauncherFn
} from './plugin-browsers'
import type {BrowserConfig, DevOptions} from './types'

// TODO cezaraugusto: move this out
import {isUsingTypeScript} from './plugin-js-frameworks/js-tools/typescript'

export async function extensionDev(
  pathOrRemoteUrl: string | undefined,
  devOptions: DevOptions & {launcher?: BrowserLauncherFn}
): Promise<BuildEmitter> {
  let browsersPlugin: BrowsersPlugin | undefined
  let emitter: BuildEmitter = new BuildEmitter()

  const projectStructure = await getProjectStructure(pathOrRemoteUrl)

  try {
    const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
    const debug = isAuthor
    const {manifestDir, packageJsonDir} = getDirs(projectStructure)

    await ensureDevelopArtifacts()
    if (devOptions.install !== false) {
      await ensureUserProjectDependencies(packageJsonDir)
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

    // Merge per-browser + per-command defaults from extension.config.js so user
    // values (profile, startingUrl, browserFlags, preferences, etc.) reach the
    // launcher. CLI devOptions take precedence — sanitize strips `undefined`
    // so unset CLI fields fall through to extension.config.js
    const browserConfig = await loadBrowserConfig(packageJsonDir, browser)
    const commandConfig = await loadCommandConfig(packageJsonDir, 'dev')
    const merged = {
      ...sanitize(browserConfig as Record<string, any>),
      ...sanitize(commandConfig as Record<string, any>),
      ...sanitize(devOptions as Record<string, any>)
    } as DevOptions & BrowserConfig

    // When a launcher is provided, create the BrowsersPlugin that wraps the
    // browser API behind rspack hooks. Otherwise fall back to a plain emitter
    // for no-browser / dry-run modes
    if (devOptions.launcher && !devOptions.noBrowser) {
      browsersPlugin = new BrowsersPlugin({
        launcher: devOptions.launcher,
        browserOptions: {
          browser,
          mode: 'development',
          enableDevtools: true,
          noOpen: merged.noOpen,
          profile: merged.profile,
          persistProfile: merged.persistProfile,
          preferences: merged.preferences,
          browserFlags: merged.browserFlags,
          excludeBrowserFlags: merged.excludeBrowserFlags,
          startingUrl: merged.startingUrl,
          chromiumBinary: merged.chromiumBinary,
          geckoBinary: merged.geckoBinary || merged.firefoxBinary,
          port: merged.port,
          source: merged.source,
          watchSource: merged.watchSource,
          sourceFormat: merged.sourceFormat,
          sourceSummary: merged.sourceSummary,
          sourceMeta: merged.sourceMeta,
          sourceProbe: merged.sourceProbe,
          sourceTree: merged.sourceTree,
          sourceConsole: merged.sourceConsole,
          sourceDom: merged.sourceDom,
          sourceMaxBytes: merged.sourceMaxBytes,
          sourceRedact: merged.sourceRedact,
          sourceIncludeShadow: merged.sourceIncludeShadow,
          sourceDiff: merged.sourceDiff,
          logLevel: merged.logLevel,
          logContexts: merged.logContexts,
          logFormat: merged.logFormat,
          logTimestamps: merged.logTimestamps,
          logColor: merged.logColor,
          logUrl: merged.logUrl,
          logTab: merged.logTab
        }
      })
      emitter = browsersPlugin.emitter
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
}
