// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {loadBrowserConfig, loadCommandConfig} from './lib/config-loader'
import {
  ensureDevelopArtifacts,
  ensureUserProjectDependencies
} from './lib/ensure-develop-artifacts'
import {generateExtensionTypes} from './lib/generate-extension-types'
import * as messages from './lib/messages'
import {getDirs, normalizeBrowser} from './lib/paths'
import {getProjectStructure} from './lib/project'
import {sanitize} from './lib/sanitize'
import {assertNoManagedDependencyConflicts} from './lib/validate-user-dependencies'
import {
  type BrowserLauncherFn,
  BrowsersPlugin,
  BuildEmitter,
  type RunnerPlugin
} from './plugin-browsers'
import {SafariDevPlugin} from './plugin-browsers/safari-dev-plugin'
import {
  ensureTypeScriptConfig,
  isUsingTypeScript
} from './plugin-js-frameworks/js-tools/typescript'
import type {BrowserConfig, DevOptions} from './types'

export async function extensionDev(
  pathOrRemoteUrl: string | undefined,
  devOptions: DevOptions & {launcher?: BrowserLauncherFn}
): Promise<BuildEmitter> {
  let browsersPlugin: RunnerPlugin | undefined
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

    // Create/validate tsconfig (and surface the "missing tsconfig" error)
    // before deciding whether to generate extension type defs.
    ensureTypeScriptConfig(manifestDir)
    if (isUsingTypeScript(manifestDir)) {
      await generateExtensionTypes(manifestDir, packageJsonDir)
    }

    const userManifestPath =
      projectStructure.packageJsonPath || projectStructure.denoJsonPath
    if (userManifestPath) {
      assertNoManagedDependencyConflicts(userManifestPath, manifestDir)
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

    // Merge per-browser + per-command defaults from extension.config.js; CLI
    // devOptions take precedence, sanitize strips undefined so unset falls through.
    const browserConfig = await loadBrowserConfig(packageJsonDir, browser)
    const commandConfig = await loadCommandConfig(packageJsonDir, 'dev')
    const merged = {
      ...sanitize(browserConfig as object),
      ...sanitize(commandConfig as object),
      ...sanitize(devOptions as object)
    } as DevOptions & BrowserConfig

    if (
      (browser === 'safari' || browser === 'webkit-based') &&
      !devOptions.noBrowser &&
      devOptions.safariPackager
    ) {
      // Identity/packaging inputs: CLI flags win over extension.config.js
      // `browser.safari` (already merged CLI-last above).
      const safariPackager = devOptions.safariPackager
      const safariOverrides = {
        appName: merged.appName,
        bundleId: merged.bundleId,
        macOsOnly: merged.macOsOnly,
        forceRegenerate: merged.forceRegenerate,
        safariBinary: merged.safariBinary
      }
      browsersPlugin = new SafariDevPlugin((distPath, packagerMode) =>
        safariPackager(distPath, packagerMode, safariOverrides)
      )
      emitter = browsersPlugin.emitter
    } else if (devOptions.launcher && !devOptions.noBrowser) {
      browsersPlugin = new BrowsersPlugin({
        launcher: devOptions.launcher,
        browserOptions: {
          browser,
          mode: 'development',
          enableDevtools: true,
          noOpen: merged.noOpen,
          profile: merged.profile,
          persistProfile: merged.persistProfile,
          keepProfileChanges: merged.keepProfileChanges,
          copyFromProfile: merged.copyFromProfile,
          preferences: merged.preferences,
          browserFlags: merged.browserFlags,
          excludeBrowserFlags: merged.excludeBrowserFlags,
          startingUrl: merged.startingUrl,
          chromiumBinary: merged.chromiumBinary,
          geckoBinary: merged.geckoBinary || merged.firefoxBinary,
          port: merged.port,
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
    } as Parameters<typeof devServer>[1])

    return emitter
  } catch (error) {
    // Always surface a minimal error: contract errors print once, clean, no stack;
    // author mode keeps the full trace.
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.error(error)
    } else {
      console.error(messages.devCommandFailed(error))
    }
    process.exit(1)
  }
}
