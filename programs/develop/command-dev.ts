// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {
  loadProjectAndCommandConfig,
  logOptionsOf,
  prepareProjectTypes,
  refuseManagedDependencyConflicts,
  resolveCommandBrowser
} from './command-steps/project-setup'
import {announceLeftoverOutputFolder} from './lib/build-output-guard'
import {
  findConfigFile,
  loadBrowserConfig,
  loadCommandConfig
} from './lib/config-loader'
import {withDarkMode} from './lib/dark-mode'
import {
  ensureDevelopArtifacts,
  ensureUserProjectDependencies
} from './lib/ensure-develop-artifacts'
import {
  DEV_COMMAND_DEFAULTS,
  falseProfileSource,
  mergeOptionLayers
} from './lib/merge-options'
import * as messages from './lib/messages'
import {debugLine, isDebug, isMachineOutput} from './lib/messaging'
import {browserOptionOrThrow, getDirs} from './lib/paths'
import {getProjectStructure} from './lib/project'
import {resolveSafariIdentity} from './lib/safari-identity'
import {
  type BrowserLauncherFn,
  BrowsersPlugin,
  BuildEmitter,
  type RunnerPlugin
} from './plugin-browsers'
import {SafariDevPlugin} from './plugin-browsers/safari-dev-plugin'
import {resolvePerfBudgets} from './plugin-perf-budgets'
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

    refuseManagedDependencyConflicts(projectStructure, packageJsonDir)

    const geckoBinary = devOptions.geckoBinary || devOptions.firefoxBinary
    // commands.dev.browser is read before the target is picked, so the config
    // can choose the browser when no --browser flag arrived.
    const browser = await resolveCommandBrowser({
      asked: askedBrowser,
      command: 'dev',
      chromiumBinary: devOptions.chromiumBinary,
      geckoBinary,
      safariBinary: devOptions.safariBinary,
      configBrowser: async (stockBrowser) =>
        (
          (await loadCommandConfig(packageJsonDir, 'dev', {
            mode: 'development',
            browser: stockBrowser
          })) as {browser?: unknown}
        ).browser
    })

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
    const {projectConfig, commandConfig} = await loadProjectAndCommandConfig(
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

    // Budgets run on a production build only, but a value build would refuse
    // is refused here too, with its code and words, before a server starts.
    resolvePerfBudgets(merged.perfBudgets, findConfigFile(packageJsonDir))

    // With the browser, folders and exclude config resolved, so this check
    // reads the entries the compiler will and writes both files or neither.
    rememberSpecialFoldersConfig(
      packageJsonDir,
      commandConfig.folders ?? browserConfig.folders ?? projectConfig.folders
    )

    rememberExcludedFiles(packageJsonDir, merged.exclude)
    await prepareProjectTypes({
      manifestDir,
      packageJsonDir,
      manifestPath: projectStructure.manifestPath,
      browser,
      envTarget
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
          ...logOptionsOf(merged)
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
