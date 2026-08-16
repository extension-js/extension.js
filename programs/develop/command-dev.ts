// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {loadBrowserConfig, loadCommandConfig} from './lib/config-loader'
import {withDarkMode} from './lib/dark-mode'
import {
  ensureDevelopArtifacts,
  ensureUserProjectDependencies
} from './lib/ensure-develop-artifacts'
import {generateExtensionTypes} from './lib/generate-extension-types'
import {DEV_COMMAND_DEFAULTS, mergeOptionLayers} from './lib/merge-options'
import * as messages from './lib/messages'
import {isDebug} from './lib/messaging'
import {getDirs, normalizeBrowser} from './lib/paths'
import {getProjectStructure} from './lib/project'
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

  // The CLI wrapper passes exitOnError=true; as a library import a failed dev
  // session must be a rejected promise, never a process.exit inside the host.
  const shouldExitOnError =
    (devOptions.exitOnError ?? false) && process.env.VITEST !== 'true'

  const projectStructure = await getProjectStructure(pathOrRemoteUrl)

  try {
    const isAuthor = isDebug()
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
      devOptions.geckoBinary || devOptions.firefoxBinary,
      devOptions.safariBinary
    )
    const geckoBinary = devOptions.geckoBinary || devOptions.firefoxBinary

    if (debug) {
      console.log(messages.debugDirs(manifestDir, packageJsonDir))
      console.log(
        messages.debugBrowser(browser, devOptions.chromiumBinary, geckoBinary)
      )
    }

    // stock defaults, then browser.*, then commands.dev, then CLI. Unset CLI
    // keys fall through so shared extension.config.js values apply.
    const browserConfig = await loadBrowserConfig(packageJsonDir, browser)
    const commandConfig = await loadCommandConfig(packageJsonDir, 'dev')
    const merged = withDarkMode({
      ...mergeOptionLayers<DevOptions & BrowserConfig>(
        DEV_COMMAND_DEFAULTS,
        browserConfig,
        commandConfig,
        devOptions
      ),
      browser
    })

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
        safariBinary: merged.safariBinary,
        noOpen: merged.noOpen
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

    // Pass the merged options so bundler-facing flags (polyfill, logger
    // options) ride the same defaults-config-CLI precedence as the browser
    // launcher above.
    await devServer(projectStructure, {
      ...merged,
      mode: 'development',
      browser,
      geckoBinary,
      browsersPlugin
    } as Parameters<typeof devServer>[1])

    return emitter
  } catch (error) {
    // Always surface a minimal error: contract errors print once, clean, no stack;
    // author mode keeps the full trace.
    if (isDebug()) {
      console.error(error)
    } else {
      console.error(messages.devCommandFailed(error))
    }
    if (!shouldExitOnError) {
      throw error
    }
    process.exit(1)
  }
}
