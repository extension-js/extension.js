// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {announceLeftoverOutputFolder} from './lib/build-output-guard'
import {
  loadBrowserConfig,
  loadCommandConfig,
  loadProjectConfigDefaults
} from './lib/config-loader'
import {withDarkMode} from './lib/dark-mode'
import {
  ensureDevelopArtifacts,
  ensureUserProjectDependencies
} from './lib/ensure-develop-artifacts'
import {generateExtensionTypes} from './lib/generate-extension-types'
import {
  DEV_COMMAND_DEFAULTS,
  falseProfileSource,
  mergeOptionLayers
} from './lib/merge-options'
import * as messages from './lib/messages'
import {debugLine, isDebug, isMachineOutput} from './lib/messaging'
import {
  browserOptionOrThrow,
  configBrowserOrThrow,
  getDirs,
  normalizeBrowser
} from './lib/paths'
import {getProjectStructure} from './lib/project'
import {resolveSafariIdentity} from './lib/safari-identity'
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
import {
  rememberExcludedFiles,
  rememberSpecialFoldersConfig
} from './plugin-special-folders/folders-config'
import type {BrowserConfig, DevOptions} from './types'

export async function extensionDev(
  pathOrRemoteUrl: string | undefined,
  // The mode is the engine's to set: a dev session always compiles in development.
  devOptions: Omit<DevOptions, 'mode'> & {
    // Called once when the session is usable: the browser opened with the
    // extension loaded, or the first compile finished when none is launched.
    onReady?: () => void
    launcher?: BrowserLauncherFn
    // Called once every refusal that can end the run before a server exists
    // has passed, so a caller can announce the session only when there is one.
    onSessionStart?: () => void
    // Called with the failure right before exitOnError ends the process, so
    // a caller can report a run that died after its session was announced.
    onExitError?: (error: unknown, code?: string) => void
    // Read by the dev server: an author session prints the debug lines.
    authorMode?: boolean
  }
): Promise<BuildEmitter> {
  let browsersPlugin: RunnerPlugin | undefined
  let emitter: BuildEmitter = new BuildEmitter()

  // The CLI wrapper passes exitOnError=true; as a library import a failed dev
  // session must be a rejected promise, never a process.exit inside the host.
  const shouldExitOnError = devOptions.exitOnError === true
  // A refusal while the project is being found is the whole answer, and
  // under machine output the frame has it. Later failures keep their lines.
  let findingProject = true

  try {
    // A name nobody knows is refused before anything is fetched or installed.
    const askedBrowser = browserOptionOrThrow(devOptions.browser)
    // Inside the try, so a missing manifest fails the way every other dev
    // failure does.
    const projectStructure = await getProjectStructure(pathOrRemoteUrl)

    findingProject = false

    const isAuthor = isDebug()
    const debug = isAuthor
    const {manifestDir, packageJsonDir} = getDirs(projectStructure)

    announceLeftoverOutputFolder(projectStructure)
    await ensureDevelopArtifacts()

    if (devOptions.install !== false) {
      await ensureUserProjectDependencies(packageJsonDir)
    }

    const userManifestPath =
      projectStructure.packageJsonPath || projectStructure.denoJsonPath

    if (userManifestPath) {
      assertNoManagedDependencyConflicts(userManifestPath, packageJsonDir)
    }

    // commands.dev.browser is read before the target is picked, so the config
    // can choose the browser when no --browser flag arrived. With a flag,
    // the first load already knows the browser and reads its env files.
    const configBrowser = askedBrowser
      ? undefined
      : configBrowserOrThrow(
          (
            (await loadCommandConfig(packageJsonDir, 'dev')) as {
              browser?: unknown
            }
          ).browser,
          'dev'
        )
    const geckoBinary = devOptions.geckoBinary || devOptions.firefoxBinary
    const namesBinary = Boolean(
      devOptions.chromiumBinary || geckoBinary || devOptions.safariBinary
    )
    // The same stock default as build. A binary with no name picks its own
    // family, so the default only applies when neither was given.
    const browser = normalizeBrowser(
      askedBrowser || configBrowser || (namesBinary ? undefined : 'chromium'),
      devOptions.chromiumBinary,
      geckoBinary,
      devOptions.safariBinary
    )

    if (debug) {
      debugLine(messages.debugDirs(manifestDir, packageJsonDir))
      debugLine(
        messages.debugBrowser(browser, devOptions.chromiumBinary, geckoBinary)
      )
    }

    // stock defaults, then top-level config, then browser.*, then
    // commands.dev, then CLI. Unset CLI keys fall through so shared
    // extension.config.js values apply. Every layer reads the env files the
    // bundle will, the browser's included.
    const envTarget = {mode: 'development', browser: String(browser)}
    const projectConfig = await loadProjectConfigDefaults(
      packageJsonDir,
      envTarget
    )
    const commandConfig = await loadCommandConfig(
      packageJsonDir,
      'dev',
      envTarget
    )
    const browserConfig = await loadBrowserConfig(
      packageJsonDir,
      browser,
      envTarget
    )
    const merged = withDarkMode({
      ...mergeOptionLayers<DevOptions & BrowserConfig>(
        DEV_COMMAND_DEFAULTS,
        projectConfig,
        browserConfig,
        commandConfig,
        devOptions
      ),
      browser
    })

    // With the browser, folders and exclude config resolved, so this check
    // reads the entries the compiler will and writes both files or neither.
    rememberSpecialFoldersConfig(
      packageJsonDir,
      commandConfig.folders ?? browserConfig.folders ?? projectConfig.folders
    )

    rememberExcludedFiles(packageJsonDir, merged.exclude)
    ensureTypeScriptConfig(manifestDir, {
      manifestPath: projectStructure.manifestPath,
      browser
    })

    if (isUsingTypeScript(manifestDir)) {
      await generateExtensionTypes(manifestDir, packageJsonDir, envTarget)
    }

    if (
      (browser === 'safari' || browser === 'webkit-based') &&
      !devOptions.noBrowser &&
      devOptions.safariPackager
    ) {
      // Identity/packaging inputs: CLI flags win over extension.config.js
      // `browser.safari` (already merged CLI-last above).
      const safariPackager = devOptions.safariPackager
      const safariOverrides = {
        ...resolveSafariIdentity(merged, packageJsonDir),
        noOpen: merged.noOpen,
        startingUrl: merged.startingUrl
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
          profileSource: falseProfileSource(merged.profile, devOptions.profile),
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

    // Heavy deps are imported lazily so preview can stay minimal.
    const {devServer} = await import('./dev-server')

    // Pass the merged options so bundler-facing flags (polyfill, logger
    // options) ride the same defaults-config-CLI precedence as the browser
    // launcher above.
    await devServer(projectStructure, {
      ...merged,
      onReady: devOptions.onReady,
      mode: 'development',
      browser,
      geckoBinary,
      browsersPlugin,
      onSessionStart: devOptions.onSessionStart,
      onExitError: devOptions.onExitError
    } as Parameters<typeof devServer>[1])

    return emitter
  } catch (error) {
    // A library caller gets the rejection and prints what it wants of it.
    // Printing here too showed the same failure twice.
    const framedByCaller = !shouldExitOnError && isMachineOutput()

    if (!shouldExitOnError && !(framedByCaller && !findingProject)) {
      throw error
    }

    // One printed block: clean, with no stack, unless author mode asks for
    // the full trace. A frame on stdout leaves the human lines to stderr.
    if (isDebug()) {
      console.error(error)
    } else {
      console.error(messages.devCommandFailed(error))
    }

    if (framedByCaller) throw error

    try {
      devOptions.onExitError?.(error)
    } catch {
      // Best-effort: a caller's report must never change how the run ends.
    }

    process.exit(1)
  }
}
