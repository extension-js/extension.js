// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {randomUUID} from 'node:crypto'
import * as path from 'node:path'
import {isDeepStrictEqual} from 'node:util'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {RspackDevServer} from '@rspack/dev-server'
import {merge} from 'webpack-merge'
import {codedError} from '../lib/coded-error'
import {recordCodedWarning} from '../lib/coded-warnings'
import {
  forgetPreloadedEnvOf,
  loadBrowserConfig,
  loadCommandConfig,
  loadConfigResolvedHook,
  loadCustomConfig,
  loadProjectConfigDefaults
} from '../lib/config-loader'
import {ConfigResolvedPlugin} from '../lib/config-resolved-plugin'
import {resolveConnectableHost} from '../lib/connectable-host'
import {
  isEmulatorBrowser,
  isGeckoBasedBrowser,
  isWebkitBasedBrowser
} from '../lib/constants'
import {
  companionsDeclaredIn,
  isFirstCompanionWarning,
  unresolvedNamedCompanions
} from '../lib/extensions-to-load'
import {DEV_COMMAND_DEFAULTS, mergeOptionLayers} from '../lib/merge-options'
import {anotherDevSessionRefused} from '../lib/messages'
import {
  CODES,
  debugLine,
  type ErrorCode,
  humanWarn,
  isDebug,
  releaseCardKeysOf,
  stripChannelPrefix
} from '../lib/messaging'
import {applySplitChunksGuard} from '../lib/normalize-split-chunks'
import {asAbsolute, getDirs, getDistPath} from '../lib/paths'
import type {ProjectStructure} from '../lib/project'
import {sanitize} from '../lib/sanitize'
import {
  ensureSessionArtifactsIgnoreFile,
  ensureSessionStateInProjectGitignore,
  readyContractPath,
  actionsPath as sessionActionsPath,
  logsPath as sessionLogsPath
} from '../lib/session-paths'
import type {BrowserLogSinkEvent} from '../plugin-browsers'
import {
  createPlaywrightMetadataWriter,
  detectLiveDevSessionOwner,
  forgetSessionRun,
  getSessionRunId
} from '../plugin-playwright'
import {
  createChangedSourcesTracker,
  dispatchReload,
  dispatchRestartReload,
  fullReloadsDeliveredTo,
  loadedContentScriptsFor,
  readDevBuild,
  reloadForBuild
} from '../plugin-reload'
import {resolveCompanionExtensionsConfig} from '../plugin-special-folders/folder-extensions/resolve-config'
import {rememberExcludedFiles} from '../plugin-special-folders/folders-config'
import {
  getSpecialFoldersDataForProjectRoot,
  rememberSpecialFoldersConfig
} from '../plugin-special-folders/get-data'
import {publicFolderOrDefault} from '../plugin-special-folders/resolve-public-folder'
import webpackConfig from '../rspack-config'
import type {
  CommonWebpackOptions,
  ConfigHookContext,
  DevOptions
} from '../types'
import {setupCleanupHandlers} from './cleanup'
import {
  setupCompilerLifecycleHooks,
  setupNoBrowserBannerOnFirstDone
} from './compiler-hooks'
import {ActionsFileWriter} from './control-bridge/actions-file'
import {BridgeBroker} from './control-bridge/broker'
import {readExtensionLoadRefusal} from './control-bridge/consumer-client'
import {CONTROL_WS_PATH, LOG_EVENT_VERSION} from './control-bridge/contracts'
import {LogsFileWriter} from './control-bridge/logs-file'
import {isLoopbackAddress} from './control-bridge/loopback'
import {LogRingBuffer} from './control-bridge/ring-buffer'
import {
  clearControlToken,
  writeControlToken
} from './control-bridge/session-token'
import {openControlBridge} from './control-bridge-start'
import {
  attachEmulatorFileIndex,
  buildEmulatorViewerUrl,
  createEmulatorFileIndexHolder,
  resolveEmulatorOrigin
} from './emulator-lane'
import {attachHtmlRefresh} from './html-refresh'
import {
  attachLifecycleStream,
  createLifecycleStream,
  humanLine,
  isLifecycleStreamEnabled,
  type LifecycleStream
} from './lifecycle-stream'
import * as messages from './messages'
import {exportInstanceId, PortManager} from './port-manager'
import {reservedHttpServer} from './reserved-listen'
import {buildServerConfig} from './server-config'
import {claimDevSession} from './session-claim'
import {endAfterFrame, registerLiveSession} from './session-end'
import {exportSessionEnv} from './session-env'
import {withGoneEntryOutputsPruned} from './session-gone-outputs'
import {createSessionHoldings} from './session-holdings'
import {
  assignCompilerToDevSession,
  bindDevSessionRestart,
  DevSessionRestartScheduler,
  endCompilerRestart,
  releaseCompilerFromDevSession,
  unbindDevSessionRestart
} from './session-restart'
import {
  buildRestartBundle,
  createSessionRestartHandler
} from './session-restart-handler'
import {isAwaitingMainWorldRestart} from './session-restart-holds'
import {withSessionStartPrune} from './session-start-prune'
import {
  announceReadyOnCleanCompile,
  createBindFailureRelay,
  createReadyAnnouncer,
  createRestartFailure,
  createStartFailure,
  declaredErrorCode,
  readStartTimeoutMs,
  releaseEndedSession,
  rethrowStartFailure,
  startBundler
} from './start-bundler'

// The root every command shares: the project manifest's folder, else the
// folder the command named, else the extension manifest's own folder.
export function resolveDevProjectRoot(
  projectStructure: ProjectStructure
): string {
  return getDirs(projectStructure).packageJsonDir
}

// What the config hooks of a dev session are told.
export function devConfigHookContext(
  browser: DevOptions['browser']
): ConfigHookContext {
  return {browser, mode: 'development', command: 'dev', rspack}
}

// What a session holds before its first start, for a start that fails.
interface SessionStartup {
  started: boolean
  // False for this host's own second start: the stdout is the live session's.
  framesFailure: boolean
  release: (() => Promise<void>) | null
  lifecycle: LifecycleStream | null
}

// Once the stream is on, a start that failed ends it with the one failed
// frame, however early it failed. One already written is left alone.
function frameFailedStart(
  error: unknown,
  lifecycle: LifecycleStream | null,
  projectStructure: ProjectStructure,
  devOptions: DevOptions
): void {
  const failure = error as {
    framed?: boolean
    session?: Record<string, unknown>
  } | null

  if (!isLifecycleStreamEnabled() || failure?.framed === true) return

  try {
    const browser = String(devOptions.browser || 'chromium')
    const stream =
      lifecycle ??
      createLifecycleStream({
        command: 'dev',
        browser,
        distPath: getDistPath(
          asAbsolute(resolveDevProjectRoot(projectStructure)),
          browser
        ),
        hintFor: devOptions.hintFor
      })

    stream.failed(
      error instanceof Error ? error.message : String(error),
      declaredErrorCode(error) ?? CODES.E_INTERNAL
    )

    if (failure && typeof failure === 'object') {
      failure.framed = stream.ended
      failure.session ??= stream.sessionValue()
    }
  } catch {
    // Best-effort: the caller is owed the failure itself.
  }
}

export async function devServer(
  projectStructure: ProjectStructure,
  devOptions: DevOptions
) {
  const startup: SessionStartup = {
    started: false,
    framesFailure: true,
    release: null,
    lifecycle: null
  }

  try {
    await startDevSession(projectStructure, devOptions, startup)
  } catch (error) {
    if (!startup.started) {
      if (startup.framesFailure) {
        frameFailedStart(error, startup.lifecycle, projectStructure, devOptions)
      }

      // A session that never started leaves nothing in a host that goes on:
      // no listener, no port, no open file.
      try {
        await startup.release?.()
      } catch {
        // The failure that ended the start is the one the caller is owed.
      }
    }

    throw error
  }
}

async function startDevSession(
  projectStructure: ProjectStructure,
  devOptions: DevOptions,
  startup: SessionStartup
) {
  // CLI-only extras that ride along on DevOptions without being part of the
  // public options contract. allowControl/allowEval used to live here too;
  // they are declared on DevOptions now so a library caller can name them.
  const extendedOptions = devOptions as DevOptions & {
    onReady?: () => void
    publicHost?: string
    allowedHosts?: string | string[]
    authorMode?: boolean
    onSessionStart?: () => void
    onExitError?: (error: unknown, code?: string) => void
    browsersPlugin?: {
      setReloadBroker?: (broker: unknown) => void
      setLogSink?: (sink: (event: BrowserLogSinkEvent) => void) => void
      setEmulatorViewerUrl?: (url: string) => void
      setInstanceId?: (instanceId: string) => void
      setReadyListener?: (listener: () => void) => void
      setLaunchSettledListener?: (listener: () => void) => void
      wakeBackground?: () => Promise<boolean>
    }
  }
  // Probe on the same host the server binds, so a port free on localhost but
  // taken on the configured host isn't picked (and vice versa).
  const portManager = new PortManager(8080)

  // The middleware reads the live compiler's output, which a restart swaps.
  let activeCompiler: Compiler | null = null
  // The compiler behind each server, to retire it when a restart replaces it.
  const compilerByServer = new WeakMap<object, Compiler>()

  let closeControlBridge: () => Promise<void> = async () => {}

  let firstServer: {stop?: () => Promise<void>} = {}
  const holdings = createSessionHoldings()

  startup.release = async () => {
    // A bundle that threw partway has no server to stop it.
    try {
      if (!firstServer.stop) activeCompiler?.close(() => {})
    } catch {
      // Ignore
    }

    await releaseEndedSession({
      server: firstServer,
      releasePort: () => portManager.terminateCurrentInstance(),
      closeControlBridge: () => closeControlBridge(),
      holdings
    })
  }

  // What the session writes for its compilers leaves the host with it.
  const exportEnv = (name: string, value: string) =>
    holdings.add(exportSessionEnv(name, value))

  exportEnv(
    'EXTENSION_BROWSER_LAUNCH_ENABLED',
    devOptions.noBrowser ? '0' : '1'
  )

  const {manifestPath} = projectStructure
  const packageJsonDir = resolveDevProjectRoot(projectStructure)
  const sessionBrowser = String(devOptions.browser || 'chromium')

  // Taken before the first await, so a second start of this host in the same
  // tick is refused here, where the contract check below cannot see it.
  const releaseClaim = claimDevSession(packageJsonDir, sessionBrowser)

  if (!releaseClaim) {
    // A frame here would read as the end of the session that holds the claim.
    startup.framesFailure = false

    throw Object.assign(
      codedError(
        CODES.E_SESSION_EXISTS,
        anotherDevSessionRefused(sessionBrowser, process.pid, null)
      ),
      {framed: false}
    )
  }

  holdings.add(releaseClaim)
  // The env file values the config loads below leave the host with it too.
  holdings.addLast(() => forgetPreloadedEnvOf(packageJsonDir))

  // The same env files as the command's own loads, so no layer differs.
  const envTarget = {mode: 'development', browser: String(devOptions.browser)}
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
    devOptions.browser,
    envTarget
  )

  const desiredPort =
    typeof devOptions.port === 'string'
      ? parseInt(devOptions.port, 10)
      : devOptions.port
  const devServerHost = devOptions.host || '127.0.0.1'
  const portAllocation = await portManager.allocatePorts(
    desiredPort,
    devServerHost
  )

  const currentInstance = portManager.getCurrentInstance()

  if (!currentInstance) {
    throw new Error('Failed to create instance')
  }

  // The eval token and the ready contract have one slot per browser, and a
  // distinct instance id keeps only the ports apart, so a second session is refused.
  const liveOwner = detectLiveDevSessionOwner(
    readyContractPath(packageJsonDir, String(devOptions.browser || 'chromium'))
  )

  if (liveOwner) {
    await portManager.terminateCurrentInstance()

    throw codedError(
      CODES.E_SESSION_EXISTS,
      anotherDevSessionRefused(
        String(devOptions.browser || 'chromium'),
        liveOwner.pid,
        liveOwner.port ?? null
      )
    )
  }

  const port = portAllocation.port

  // `devServerHost` is the BIND host (e.g. 0.0.0.0 in a devcontainer). Clients
  // must dial a CONNECTABLE host: a wildcard bind is not a valid client target.
  const connectableHost = resolveConnectableHost(
    devServerHost,
    extendedOptions.publicHost
  )

  const devServerWebSocketURL = {
    protocol: 'ws',
    hostname: connectableHost,
    port
  }
  exportEnv('EXTENSION_DEV_SERVER_PROTOCOL', devServerWebSocketURL.protocol)
  exportEnv('EXTENSION_DEV_SERVER_HOST', devServerHost)
  exportEnv('EXTENSION_DEV_SERVER_CONNECTABLE_HOST', connectableHost)
  exportEnv('EXTENSION_DEV_SERVER_PORT', String(port))
  exportEnv('EXTENSION_DEV_SERVER_PATH', '/ws')

  const browserName = String(devOptions.browser || 'chromium')
  const emulatorLane = isEmulatorBrowser(browserName)
  const emulatorOrigin = emulatorLane ? resolveEmulatorOrigin() : null
  // One canonical dist output path per browser, shared with `build`/`preview`.
  // Inline `dist/<browser>` joins let output/manifest/ready.json paths drift.
  const primaryDistPath = getDistPath(asAbsolute(packageJsonDir), browserName)
  const bridgeLogsAbsPath = sessionLogsPath(packageJsonDir, browserName)
  // The session root self-ignores so a project with no .gitignore can't
  // commit the managed profile (cookies/logins) or session logs.
  ensureSessionArtifactsIgnoreFile(packageJsonDir)
  // Adopted projects also get .extension-js (live control token) merged
  // into their root .gitignore, which create-path scaffolds already have.
  ensureSessionStateInProjectGitignore(packageJsonDir)
  // The ready contract publishes it project-relative.
  const bridgeLogsRelPath = path.relative(packageJsonDir, bridgeLogsAbsPath)
  // logs.ndjson/events.ndjson rows must stamp the SAME runId ready.json
  // publishes, or consumers joining on it read every live row as foreign.
  const sessionRunId = getSessionRunId(packageJsonDir, browserName)

  // After the final contract write and everything else the release does.
  // The next session in this host is a new run and draws its own id.
  holdings.addLast(() => forgetSessionRun(packageJsonDir, browserName))
  // The identity card of this output leaves the host with the session.
  holdings.addLast(() => releaseCardKeysOf(path.resolve(primaryDistPath)))

  const bridgeLogFile = new LogsFileWriter({
    filePath: bridgeLogsAbsPath,
    runId: sessionRunId
  })

  // --allow-eval implies --allow-control: eval is strictly stronger, and the
  // eval refusals name --allow-eval alone as the remedy, so it must suffice.
  const allowEval = Boolean(extendedOptions.allowEval)
  const allowControl = Boolean(extendedOptions.allowControl) || allowEval
  const authorMode = Boolean(extendedOptions.authorMode) || isDebug()
  const bridgeActionsFile = allowControl
    ? new ActionsFileWriter({
        filePath: sessionActionsPath(packageJsonDir, browserName),
        owner: {runId: sessionRunId, logsFilePath: bridgeLogsAbsPath}
      })
    : undefined

  // The eval token is written 0600 OUTSIDE dist/ when eval is enabled, and
  // when the bind host admits peers beyond loopback, who must present it.
  const bridgeControlToken =
    (allowControl && allowEval) || !isLoopbackAddress(devServerHost)
      ? writeControlToken(packageJsonDir, browserName)
      : undefined

  // Flush buffered logs on process exit (interval flush handles the steady
  // state), or when the session ends and its host keeps running.
  holdings.add(() => {
    try {
      bridgeLogFile.close()
    } catch {
      // Ignore
    }

    try {
      bridgeActionsFile?.close()
    } catch {
      // Ignore
    }

    // Never leave a usable eval token behind after the session ends.
    if (bridgeControlToken) {
      clearControlToken(packageJsonDir, browserName, bridgeControlToken)
    }
  })

  // The metadata writer is created later (it needs the resolved control port);
  // the SW connects after that, so a mutable holder bridges the ordering.
  let stampExecutorAttached:
    | ((attached?: {origin?: string}) => void)
    | undefined
  let stampExecutorDetached: (() => void) | undefined
  let stampReload: ((kind: string, label?: string) => void) | undefined
  const bridgeBroker = new BridgeBroker({
    instanceId: currentInstance.instanceId,
    runId: sessionRunId,
    // Safari is its own engine. The producer already names itself webkit from
    // its url scheme, so the server saying chromium made the two disagree.
    engine: emulatorLane
      ? 'emulator'
      : isGeckoBasedBrowser(browserName)
        ? 'firefox'
        : isWebkitBasedBrowser(browserName)
          ? 'webkit'
          : 'chromium',
    viewerOrigin: emulatorOrigin,
    ring: new LogRingBuffer(),
    file: bridgeLogFile,
    allowControl,
    allowEval,
    controlToken: bridgeControlToken,
    actions: bridgeActionsFile,
    authorMode,
    onExecutorAttached: (attached) => stampExecutorAttached?.(attached),
    onExecutorDetached: () => stampExecutorDetached?.(),
    // Only Gecko suspends the background with no way back short of an event.
    ...(isGeckoBasedBrowser(browserName) &&
    typeof extendedOptions.browsersPlugin?.wakeBackground === 'function'
      ? {
          wakeExecutor: async () =>
            (await extendedOptions.browsersPlugin?.wakeBackground?.()) === true
        }
      : {}),
    onReloadApplied: (kind, label) => stampReload?.(kind, label),
    onLateBootRegistration: (afterMs) =>
      humanLine(messages.lateBootRegistration(afterMs)),
    readLoadRefusal: () =>
      readExtensionLoadRefusal(packageJsonDir, browserName, sessionRunId)
  })

  // Hand the broker to a launched runner plugin so every engine reloads
  // through the SW producer, the same executor as --no-browser.
  const launchedPlugin = extendedOptions.browsersPlugin

  if (launchedPlugin && typeof launchedPlugin.setReloadBroker === 'function') {
    launchedPlugin.setReloadBroker(bridgeBroker)
  }

  if (launchedPlugin && typeof launchedPlugin.setInstanceId === 'function') {
    launchedPlugin.setInstanceId(currentInstance.instanceId)
  }

  const announceReady = createReadyAnnouncer(extendedOptions.onReady)

  if (launchedPlugin && typeof launchedPlugin.setReadyListener === 'function') {
    launchedPlugin.setReadyListener(announceReady)
  }

  // Browser-generated warnings (CDP Log.entryAdded) never pass through the
  // extension's console hook; the launcher forwards them into the same pipeline.
  if (launchedPlugin && typeof launchedPlugin.setLogSink === 'function') {
    launchedPlugin.setLogSink((event) => {
      try {
        bridgeBroker.ingestLog({
          v: LOG_EVENT_VERSION,
          id: randomUUID(),
          timestamp: event.timestamp ?? Date.now(),
          level: event.level,
          // Browser-emitted entries attach to extension sessions (SW or
          // extension pages); 'background' is the closest context bucket.
          context: 'background',
          messageParts: [event.text],
          url: event.url,
          data: {
            channel: 'browser',
            ...(event.source ? {source: event.source} : {}),
            ...(typeof event.lineNumber === 'number'
              ? {lineNumber: event.lineNumber}
              : {})
          },
          runId: sessionRunId
        })
      } catch {
        // Best-effort: a log-pipeline hiccup must never break the launch path.
      }
    })
  }

  const controlBridge = await openControlBridge({
    broker: bridgeBroker,
    host: devServerHost,
    viewerOrigin: emulatorOrigin,
    packageJsonDir,
    browserName,
    logFile: bridgeLogFile,
    actionsFile: bridgeActionsFile
  })
  closeControlBridge = controlBridge.close
  const bridgeControlPort = controlBridge.controlPort
  const controlPortUnavailableReason = controlBridge.unavailableReason

  // Only --port bounds a port, so a debug run names the others it listens on.
  if (isDebug()) debugLine(messages.debugSessionPorts(port, bridgeControlPort))

  // Expose control-channel coordinates to the compiler (same process) so the
  // bridge-producer injector can bake them into the background SW
  // An id the session drew leaves the environment with it, so the next
  // session of this host does not read it as a pin.
  if (currentInstance.instanceExplicit) {
    exportEnv('EXTENSION_INSTANCE_ID', currentInstance.instanceId)
  } else {
    holdings.add(exportInstanceId(currentInstance.instanceId))
  }

  exportEnv(
    'EXTENSION_CONTROL_PORT',
    bridgeControlPort != null ? String(bridgeControlPort) : ''
  )

  const emulatorFiles = emulatorLane
    ? createEmulatorFileIndexHolder(currentInstance.instanceId)
    : null
  const emulatorViewer =
    emulatorLane && emulatorOrigin
      ? buildEmulatorViewerUrl({
          origin: emulatorOrigin,
          host: connectableHost,
          port,
          controlPort: bridgeControlPort,
          controlPath: CONTROL_WS_PATH,
          instanceId: currentInstance.instanceId
        })
      : null

  if (
    emulatorViewer &&
    launchedPlugin &&
    typeof launchedPlugin.setEmulatorViewerUrl === 'function'
  ) {
    launchedPlugin.setEmulatorViewerUrl(emulatorViewer)
  }

  // stock defaults, then top-level config, then browser.*, then commands.dev,
  // then CLI/caller. Undefined values are stripped per layer so unset CLI
  // flags never clobber extension.config.js values.
  const safeProjectConfig = sanitize(projectConfig)
  const safeBrowserConfig = sanitize(browserConfig)
  const safeCommandConfig = sanitize(commandConfig)
  const safeDevOptions = sanitize(devOptions)
  const mergedDevOptions = mergeOptionLayers<DevOptions>(
    DEV_COMMAND_DEFAULTS,
    safeProjectConfig,
    safeBrowserConfig,
    safeCommandConfig,
    safeDevOptions
  )
  const foldersConfig =
    safeCommandConfig.folders ??
    safeBrowserConfig.folders ??
    safeProjectConfig.folders
  rememberSpecialFoldersConfig(packageJsonDir, foldersConfig)
  // Same reason as the folders config: the first plugin that reads the
  // special folders holds only a compiler and runs before the plugin that
  // owns the key.
  rememberExcludedFiles(
    packageJsonDir,
    (mergedDevOptions as Partial<CommonWebpackOptions>).exclude
  )

  const specialFoldersData = getSpecialFoldersDataForProjectRoot(
    packageJsonDir,
    foldersConfig
  )

  const mergedExtensionsConfig =
    safeDevOptions.extensions ??
    safeCommandConfig.extensions ??
    safeBrowserConfig.extensions ??
    safeProjectConfig.extensions ??
    specialFoldersData.extensions
  const resolvedExtensionsConfig = await resolveCompanionExtensionsConfig({
    projectRoot: packageJsonDir,
    browser: devOptions.browser,
    config: mergedExtensionsConfig
  })

  // The caller hands over options it already merged with the config, so a
  // list equal to what the config layers give was not typed as a flag.
  const configuredExtensions =
    safeCommandConfig.extensions ??
    safeBrowserConfig.extensions ??
    safeProjectConfig.extensions

  // Said here, where the layer that named the companion is known. The
  // compiler config finds the same entry and leaves it to this line.
  for (const companion of unresolvedNamedCompanions({
    projectRoot: packageJsonDir,
    resolved: resolvedExtensionsConfig,
    declared: mergedExtensionsConfig,
    declaredIn: companionsDeclaredIn('dev', {
      flag: isDeepStrictEqual(safeDevOptions.extensions, configuredExtensions)
        ? undefined
        : safeDevOptions.extensions,
      command: safeCommandConfig.extensions,
      browser: safeBrowserConfig.extensions,
      project: safeProjectConfig.extensions
    })
  })) {
    if (!isFirstCompanionWarning(companion.manifestPath)) continue

    recordCodedWarning(
      CODES.W_COMPANION_EXTENSION_PATH,
      stripChannelPrefix(companion.frame)
    )

    humanWarn(companion.frame)
  }

  // An act verb reaches the browser through the extension's background, so a
  // session that takes them and opens a browser holds ready for its hello.
  const readyAwaitsExecutor =
    allowControl && Boolean(extendedOptions.browsersPlugin)

  const webpackConfigOptions = {
    // The dev server is the one dev session: instrumentation keys on this.
    metadataCommand: 'dev' as const,
    ...mergedDevOptions,
    extensions: resolvedExtensionsConfig,
    browser: devOptions.browser,
    mode: 'development' as const,
    instanceId: currentInstance.instanceId,
    instanceExplicit: currentInstance.instanceExplicit,
    controlPort: bridgeControlPort,
    controlPortUnavailableReason,
    controlPath: CONTROL_WS_PATH,
    logsPath: bridgeLogsRelPath,
    connectableHost,
    readyAwaitsExecutor,
    port: portAllocation.port,
    output: {
      clean: false,
      path: primaryDistPath
    }
  }

  const metadata = createPlaywrightMetadataWriter({
    packageJsonDir,
    browser: String(devOptions.browser || 'chromium'),
    command: 'dev',
    distPath: primaryDistPath,
    manifestPath,
    port,
    host: connectableHost,
    instanceId: currentInstance.instanceId,
    instanceExplicit: currentInstance.instanceExplicit,
    controlPort: bridgeControlPort,
    controlPortUnavailableReason,
    controlPath: CONTROL_WS_PATH,
    logsPath: bridgeLogsRelPath,
    readyAwaitsRdpPort: Boolean(extendedOptions.browsersPlugin),
    readyAwaitsCdpPort:
      typeof launchedPlugin?.setLaunchSettledListener === 'function',
    readyAwaitsExecutor
  })

  launchedPlugin?.setLaunchSettledListener?.(() =>
    metadata.settleBrowserLaunch()
  )

  stampExecutorAttached = (attached) => metadata.stampExecutorAttached(attached)
  stampExecutorDetached = () => metadata.stampExecutorDetached()
  stampReload = (kind, label) => metadata.stampReload(kind, label)

  // Bound once the session can end itself. A usage refusal the first compile
  // reports before then waits here for it.
  let endOnUsageRefusal:
    | ((
        code: ErrorCode,
        message: string,
        ready: Record<string, unknown>
      ) => void)
    | null = null
  const pendingUsageRefusal: Array<
    [ErrorCode, string, Record<string, unknown>]
  > = []

  // One schema-1 frame per lifecycle transition, on stdout, only when the
  // command layer asked for machine output (EXTENSION_OUTPUT=ndjson).
  const lifecycle = createLifecycleStream({
    command: 'dev',
    browser: browserName,
    distPath: primaryDistPath,
    readyPath: metadata.readyPath,
    eventsPath: metadata.eventsPath,
    noBrowser: Boolean(devOptions.noBrowser),
    hintFor: devOptions.hintFor,
    onUsageRefusal: (code, message, ready) => {
      if (endOnUsageRefusal) endOnUsageRefusal(code, message, ready)
      else pendingUsageRefusal.push([code, message, ready])
    }
  })
  startup.lifecycle = lifecycle
  holdings.addForRelease(lifecycle.emitOnExit())

  // Say so when the requested port was taken. Compare numerically: a CLI
  // --port arrives as a string, and '55835' !== 55835 misreported every run.
  if (messages.shouldWarnPortConflict(devOptions.port, port)) {
    humanLine(messages.portInUse(Number(devOptions.port), port))
  }

  const bindFailure = createBindFailureRelay()
  // Same rule as the dev command: only a caller that asked for it is exited.
  const exitOnStartFailure =
    (devOptions.exitOnError ?? false) && process.env.VITEST !== 'true'

  // `folders: {public: false}` reads no folder at all, so there is nothing to
  // serve over HTTP and nothing to watch for a rebuild.
  const publicFolder = publicFolderOrDefault(manifestPath, packageJsonDir)
  const serverConfig = buildServerConfig({
    host: devServerHost,
    port,
    connectableHost,
    emulatorOrigin,
    allowedHosts: extendedOptions.allowedHosts,
    isSessionExtensionOrigin: (origin) =>
      bridgeBroker.isSessionExtensionOrigin(origin),
    publicFolder,
    packageJsonDir,
    emulatorFiles,
    activeCompiler: () => activeCompiler,
    onHostRefused: (host) => humanLine(messages.devServerHostRefused(host)),
    onSiteRefused: (origin) =>
      humanLine(messages.devServerOutsideRequestRefused(origin)),
    server: {
      type: reservedHttpServer({
        takeReservation: () => portManager.takeReservation(),
        onBindError: (error) => bindFailure.report(error),
        holdOnClose: () => portManager.shouldHoldPortOnClose(),
        onHeld: (reservation) => portManager.adoptHeldPort(reservation)
      })
    }
  })

  const START_TIMEOUT_MS = readStartTimeoutMs()

  // What the compilers of this session wrote, so a restart can tell the
  // outputs of an entry that is gone from a file it never wrote.
  const sessionOutputs = new Set<string>()

  // Plugins that find an entrypoint change ask for a restart. The request
  // outlives the compiler that noticed it because this belongs to the session.
  const sessionRestart = new DevSessionRestartScheduler()

  // One compiler and server per include list. A restart builds the next pair
  // from the same session (ports, instance, broker, launched browser) and only
  // the bundler is torn down.
  async function createCompilerAndServer(opts: {isRestart: boolean}) {
    const baseConfig = webpackConfig(projectStructure, webpackConfigOptions)
    const hookContext = devConfigHookContext(webpackConfigOptions.browser)
    const customWebpackConfig = await loadCustomConfig(
      packageJsonDir,
      hookContext
    )
    const compilerConfig = applySplitChunksGuard(
      merge(customWebpackConfig(baseConfig), {})
    )
    const configResolved = await loadConfigResolvedHook(
      packageJsonDir,
      envTarget
    )

    if (configResolved) {
      compilerConfig.plugins = [
        ...(compilerConfig.plugins || []),
        new ConfigResolvedPlugin(configResolved, hookContext)
      ]
    }

    // Decided before the compiler exists: its metadata writer takes over
    // ready.json, after which the earlier session's claim can not be read.
    const compiler = rspack(
      withGoneEntryOutputsPruned(
        withSessionStartPrune(compilerConfig, {
          isRestart: opts.isRestart,
          distPath: primaryDistPath,
          readyPath: metadata.readyPath
        }),
        {
          isRestart: opts.isRestart,
          distPath: primaryDistPath,
          written: sessionOutputs
        }
      )
    )
    activeCompiler = compiler
    assignCompilerToDevSession(compiler, sessionRestart)

    // The broker tells a background this session built from one a kept
    // profile still runs from an earlier session, before any hello arrives.
    if (compiler?.hooks?.done?.tap) {
      compiler.hooks.done.tap(
        {name: 'extjs-session-builds', stage: -1000},
        (stats: Stats) => {
          bridgeBroker.noteSessionBuild(readDevBuild(stats?.compilation))
        }
      )
    }

    // Under --no-browser no CDP controller owns reload, so broadcast the same
    // classified reload decision over the control bridge; gated to avoid double-reload.
    if (!extendedOptions.browsersPlugin && compiler?.hooks?.watchRun) {
      const changedSources = createChangedSourcesTracker(compiler)
      let isFirstBridgeCompile = true
      // The browser the user runs keeps the manifest it loaded as much as a
      // launched one does, so a renamed bundle or rewritten sheet counts here.
      const loadedContentScripts = loadedContentScriptsFor(browserName)

      compiler.hooks.done.tapPromise(
        'extjs-no-browser-reload',
        async (stats: Stats) => {
          const compilation = stats.compilation
          if (compilation.errors && compilation.errors.length > 0) return

          // Skip the first compile: it's the initial build, not a change, and the
          // SW producer hasn't connected yet anyway.
          if (isFirstBridgeCompile) {
            isFirstBridgeCompile = false
            loadedContentScripts?.noteLoaded(compilation)

            return
          }

          // The restart this build asked for reloads the extension once with
          // the build that replaces it. Reloading here too starts it twice.
          if (isAwaitingMainWorldRestart(compiler, compilation)) return

          const instruction = reloadForBuild(compilation, {
            changedSources,
            loaded: loadedContentScripts
          })

          // Same shared dispatch seam as the launched path, here with the broker
          // (SW producer) as the executor. Honors EXTENSION_NO_RELOAD.
          const delivered = await dispatchReload(instruction, {
            broker: bridgeBroker,
            build: readDevBuild(compilation)
          })

          loadedContentScripts?.settle(delivered)
        }
      )
    }

    if (!extendedOptions.browsersPlugin) {
      announceReadyOnCleanCompile(compiler, announceReady)
    }

    if (emulatorFiles) attachEmulatorFileIndex(compiler, emulatorFiles)

    if (emulatorViewer && !opts.isRestart && devOptions.noBrowser) {
      let printedViewer = false

      compiler.hooks.done.tap('extjs-emulator-viewer-url', (stats: Stats) => {
        if (printedViewer || stats?.hasErrors?.()) return

        printedViewer = true
        humanLine(messages.emulatorViewerUrl(emulatorViewer))
      })
    }

    // Tapped after the ready-contract writer, so ready.json is on disk when the
    // ready frame reads it.
    attachLifecycleStream(compiler, lifecycle, {restart: opts.isRestart})

    // Surface invalidation/fatal startup diagnostics during startup. Done-hook
    // warning/error output is registered earlier so it prints before launch hooks.
    setupCompilerLifecycleHooks(compiler)

    if (!opts.isRestart && devOptions.noBrowser) {
      setupNoBrowserBannerOnFirstDone({
        compiler,
        browser: String(devOptions.browser || 'chromium'),
        manifestPath,
        readyPath: metadata.readyPath,
        distPath: primaryDistPath
      })
    }

    const firstCompile = new Promise<Stats | null>((resolve) => {
      let settled = false

      const finish = (stats: Stats | null) => {
        if (settled) return

        settled = true
        resolve(stats)
      }

      if (!compiler.hooks?.done?.tap) {
        finish(null)

        return
      }

      compiler.hooks.done.tap('extjs-session-restart-first-done', (stats) => {
        finish(stats)
      })

      compiler.hooks.failed?.tap?.('extjs-session-restart-first-failed', () => {
        finish(null)
      })
    })

    const server = new RspackDevServer(serverConfig, compiler)
    attachHtmlRefresh(compiler, server)

    compilerByServer.set(server, compiler)

    return {compiler, server, firstCompile}
  }

  const createRestartBundle = () =>
    buildRestartBundle({
      build: () => createCompilerAndServer({isRestart: true}),
      activeCompiler: () => activeCompiler,
      setActiveCompiler: (compiler) => {
        activeCompiler = compiler
      }
    })

  const failStart = createStartFailure({
    metadata,
    lifecycle,
    onExitError: extendedOptions.onExitError,
    exitOnError: exitOnStartFailure
  })

  const startSessionBundler = (
    server: RspackDevServer,
    onFailure: (error: unknown) => void = failStart
  ) =>
    startBundler(
      {start: () => bindFailure.during(() => server.start())},
      {
        timeoutMs: START_TIMEOUT_MS,
        onSlowStart: () =>
          console.error(messages.devServerStartTimeout(START_TIMEOUT_MS)),
        onFailure
      }
    )

  const firstBundle = await createCompilerAndServer({isRestart: false})
  let currentServer: RspackDevServer | null = firstBundle.server
  firstServer = firstBundle.server

  // The session is announced once the config and compiler exist. Said before
  // them, an ok frame went out ahead of a manifest the config then refused.
  try {
    extendedOptions.onSessionStart?.()
  } catch {
    // Best-effort: a caller's announcement must never stop the session.
  }

  lifecycle.starting({requestedPort: Number(devOptions.port), port})

  // A start that fails rejects to a caller that keeps running, and the
  // release of everything opened so far is the one devServer runs.
  await startSessionBundler(firstBundle.server)

  let isShuttingDown = false
  const restartFailure = createRestartFailure({
    metadata,
    lifecycle,
    keepServing: () => endCompilerRestart(activeCompiler ?? undefined),
    hasQueuedRestart: () => sessionRestart.hasQueuedRequest(),
    release: (server) =>
      releaseEndedSession({
        server,
        releasePort: () => portManager.terminateCurrentInstance(),
        closeControlBridge: controlBridge.close,
        holdings
      }),
    onExitError: extendedOptions.onExitError,
    exitOnError: exitOnStartFailure
  })
  sessionRestart.setFailureHandler((error) => restartFailure.unexpected(error))
  sessionRestart.setHandler(
    createSessionRestartHandler<RspackDevServer>({
      announce: (request) => humanLine(messages.devServerRestarting(request)),
      createBundle: createRestartBundle,
      currentServer: () => currentServer,
      setCurrentServer: (server) => {
        currentServer = server
      },
      retireServer: (server) =>
        releaseCompilerFromDevSession(compilerByServer.get(server)),
      holdPort: () => portManager.holdPortAcrossRestart(),
      endPortHold: () => portManager.endRestartHold(),
      // A restart reports its own failure, so the start only rejects here.
      startBundler: (server) =>
        startSessionBundler(server, rethrowStartFailure),
      isShuttingDown: () => isShuttingDown,
      onBundleFailure: restartFailure.bundle,
      onStopFailure: restartFailure.stop,
      onStartFailure: restartFailure.start,
      onUnexpectedFailure: restartFailure.unexpected,
      fullReloadsDelivered: () => fullReloadsDeliveredTo(bridgeBroker),
      reloadAfterRestart: (fullReloadsBefore) =>
        dispatchRestartReload({broker: bridgeBroker}, fullReloadsBefore)
    })
  )

  bindDevSessionRestart(sessionRestart)
  holdings.addEarly(() => {
    sessionRestart.dispose()
    unbindDevSessionRestart(sessionRestart)
  })

  // The launcher stamps browserExitedAt on the ready contract; poll for it so
  // a machine consumer learns the browser died without scraping prose. The
  // same read tells the broker, so act verbs name the exit instead of an
  // idle worker, and lands on the events timeline beside the compiles.
  const stopBrowserExitWatch = lifecycle.watchBrowserExit(1000, (ready) => {
    const exitCode =
      typeof ready.browserExitCode === 'number' ? ready.browserExitCode : null
    const exitSignal =
      typeof ready.browserExitSignal === 'string'
        ? ready.browserExitSignal
        : null
    const browserExitedAt = String(ready.browserExitedAt)
    const how =
      exitCode == null
        ? `signal ${exitSignal ?? 'unknown'}`
        : `code ${exitCode}`

    bridgeBroker.noteBrowserExited(browserExitedAt, how)
    metadata.appendEvent({
      type: 'browser_exited',
      ts: new Date().toISOString(),
      command: 'dev',
      browser: browserName,
      exitCode,
      exitSignal,
      browserExitedAt
    })
  })

  // Same mirror for a browser that never came up: the launcher stamps why on
  // the contract, and the timeline says so beside the compile that tried.
  // A usage refusal ends the session before the next poll, so it writes the
  // event itself. The stamp keeps the two writers to one line per launch.
  let recordedLaunchFailure: string | null = null

  const recordLaunchFailure = (ready: Record<string, unknown>) => {
    const stamp = String(ready.browserLaunchFailedAt)
    if (stamp === recordedLaunchFailure) return

    recordedLaunchFailure = stamp
    metadata.appendEvent({
      type: 'browser_launch_failed',
      ts: new Date().toISOString(),
      command: 'dev',
      browser: browserName,
      browserLaunchFailedAt: stamp,
      reason:
        typeof ready.browserLaunchFailedReason === 'string'
          ? ready.browserLaunchFailedReason
          : undefined
    })
  }

  const stopLaunchFailureWatch = lifecycle.watchBrowserLaunchFailure(
    1000,
    recordLaunchFailure
  )

  holdings.addEarly(stopBrowserExitWatch)
  holdings.addEarly(stopLaunchFailureWatch)

  const disposeCleanupHandlers = setupCleanupHandlers(
    () => currentServer,
    portManager,
    (signal) => {
      lifecycle.interrupted(signal)
    },
    {
      closeControlBridge: controlBridge.close,
      // No restart may begin, and one already running stops at its next step.
      onShutdownStart: () => {
        isShuttingDown = true
        sessionRestart.dispose()
        unbindDevSessionRestart(sessionRestart)
      },
      onShutdownTimedOut: (timeoutMs, exitCode) => {
        lifecycle.shutdownTimedOut(timeoutMs, exitCode)
      }
    }
  )
  holdings.addForRelease(disposeCleanupHandlers)

  // Writes the frame, then exits the CLI or releases a library host's session.
  const endSession = (
    writeFrame: () => void,
    first: Array<() => unknown> = []
  ) => {
    if (exitOnStartFailure) {
      return endAfterFrame(writeFrame, [
        ...first,
        () => disposeCleanupHandlers.endAsFailed()
      ])
    }

    return endAfterFrame(writeFrame, [
      ...first,
      () => {
        isShuttingDown = true
      },
      () => sessionRestart.dispose(),
      () => unbindDevSessionRestart(sessionRestart),
      () =>
        releaseEndedSession({
          server: currentServer ?? {},
          releasePort: () => portManager.terminateCurrentInstance(),
          closeControlBridge: controlBridge.close,
          holdings
        })
    ])
  }

  // A host that knows the session cannot go on ends it through here. The CLI
  // shuts down and exits 1, a library host keeps running with one session less.
  holdings.addEarly(
    registerLiveSession(currentInstance.instanceId, (code, message) => {
      // A session already stopping keeps the frame and exit code it has.
      if (isShuttingDown) return false

      return endSession(() => {
        metadata.writeEndedAsFailed(code, message)
        lifecycle.failed(message, code)
      })
    })
  )

  // The usage frame is already out. The CLI host exits through onExitError
  // under --output json, where nothing here exits the process.
  endOnUsageRefusal = (code, message, ready) => {
    if (isShuttingDown) return

    const refusal = Object.assign(new Error(message), {code})

    endSession(() => {
      recordLaunchFailure(ready)
      metadata.writeEndedAsFailed(code, message)
    }, [() => extendedOptions.onExitError?.(refusal, code)])
  }

  for (const [code, message, ready] of pendingUsageRefusal.splice(0)) {
    endOnUsageRefusal(code, message, ready)
  }

  // Only now is the session live: a throw in the wiring above still releases
  // the claim, the port and the server through the failed start.
  startup.started = true
}
