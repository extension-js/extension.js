// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {randomUUID} from 'node:crypto'
import type * as FsTypes from 'node:fs'
import fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {Writable} from 'node:stream'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {RspackDevServer} from '@rspack/dev-server'
import {merge} from 'webpack-merge'
import {codedError} from '../lib/coded-error'
import {
  loadBrowserConfig,
  loadCommandConfig,
  loadConfigResolvedHook,
  loadCustomConfig,
  loadProjectConfigDefaults
} from '../lib/config-loader'
import {ConfigResolvedPlugin} from '../lib/config-resolved-plugin'
import {
  isEmulatorBrowser,
  isGeckoBasedBrowser,
  isWebkitBasedBrowser
} from '../lib/constants'
import {DEV_COMMAND_DEFAULTS, mergeOptionLayers} from '../lib/merge-options'
import {anotherDevSessionRefused} from '../lib/messages'
import {CODES, debugLine, isDebug} from '../lib/messaging'
import {applySplitChunksGuard} from '../lib/normalize-split-chunks'
import {asAbsolute, getDistPath} from '../lib/paths'
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
  buildSourceFeatureIndex,
  classifyReloadFromSources,
  createChangedSourcesTracker,
  createLoadedContentScripts,
  dispatchReload,
  dispatchRestartReload,
  fullReloadsDeliveredTo,
  readContentScriptCount,
  readDevBuild
} from '../plugin-reload'
import {resolveCompanionExtensionsConfig} from '../plugin-special-folders/folder-extensions/resolve-config'
import {rememberExcludedFiles} from '../plugin-special-folders/folders-config'
import {
  getSpecialFoldersDataForProjectRoot,
  rememberSpecialFoldersConfig
} from '../plugin-special-folders/get-data'
import {publicFolderOrDefault} from '../plugin-special-folders/resolve-public-folder'
import {isAwaitingMainWorldRestart} from '../plugin-web-extension/feature-scripts/steps/warn-main-world-registration-changed'
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
import {resolveConnectableHost} from './connectable-host'
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
import {registerLiveSession} from './session-end'
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

function isSamePath(left: string, right: string) {
  return path.resolve(left) === path.resolve(right)
}

function isManifestTempPath(filePath: string) {
  const base = path.basename(filePath)

  return base.startsWith('.manifest.') && base.endsWith('.tmp')
}

function createDiscardWriteStream() {
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    }
  })

  stream.on('finish', () => {
    stream.emit('close')
  })

  process.nextTick(() => {
    stream.emit('open', 0)
  })

  return stream as Writable & {path?: string}
}

// Ref-counted per path: two servers can guard the same dist and the guard
// only forgets a path when its last owner uninstalls.
const guardedManifestDiskWritePaths = new Map<string, number>()
let isManifestDiskWriteGuardInstalled = false
let restoreManifestDiskWriteGuardPatches: (() => void) | null = null

function hasGuardedManifestDiskPath(filePath: unknown) {
  if (typeof filePath !== 'string') return false

  const resolvedPath = path.resolve(filePath)

  for (const guardedPath of guardedManifestDiskWritePaths.keys()) {
    if (isSamePath(guardedPath, resolvedPath)) return true
  }

  return false
}

export function installManifestDiskWriteGuard(
  manifestOutputPath: string
): () => void {
  const guardKey = path.resolve(manifestOutputPath)
  guardedManifestDiskWritePaths.set(
    guardKey,
    (guardedManifestDiskWritePaths.get(guardKey) || 0) + 1
  )

  let uninstalled = false

  const uninstall = () => {
    if (uninstalled) return

    uninstalled = true
    const count = guardedManifestDiskWritePaths.get(guardKey) || 0
    if (count <= 1) guardedManifestDiskWritePaths.delete(guardKey)
    else guardedManifestDiskWritePaths.set(guardKey, count - 1)

    if (
      guardedManifestDiskWritePaths.size === 0 &&
      restoreManifestDiskWriteGuardPatches
    ) {
      restoreManifestDiskWriteGuardPatches()
      restoreManifestDiskWriteGuardPatches = null
      isManifestDiskWriteGuardInstalled = false
    }
  }

  if (isManifestDiskWriteGuardInstalled) return uninstall

  const guardedFs = fs

  const isManifestPath = (filePath: unknown) =>
    hasGuardedManifestDiskPath(filePath)

  const allowManifestRename = (fromPath: unknown, toPath: unknown) =>
    typeof fromPath === 'string' &&
    typeof toPath === 'string' &&
    isManifestPath(toPath) &&
    isManifestTempPath(fromPath)

  const originalWriteFile = guardedFs.writeFile.bind(guardedFs)
  guardedFs.writeFile = ((
    filePath: FsTypes.PathOrFileDescriptor,
    ...args: unknown[]
  ) => {
    if (isManifestPath(filePath)) {
      const callback = args[args.length - 1]
      if (typeof callback === 'function') callback(null)

      return
    }

    return (originalWriteFile as (...a: unknown[]) => unknown)(
      filePath,
      ...args
    )
  }) as typeof fs.writeFile

  const originalWriteFileSync = guardedFs.writeFileSync.bind(guardedFs)
  guardedFs.writeFileSync = ((
    filePath: FsTypes.PathOrFileDescriptor,
    ...args: unknown[]
  ) => {
    if (isManifestPath(filePath)) return

    return (originalWriteFileSync as (...a: unknown[]) => unknown)(
      filePath,
      ...args
    )
  }) as typeof fs.writeFileSync

  const originalCreateWriteStream = guardedFs.createWriteStream.bind(guardedFs)
  guardedFs.createWriteStream = ((
    filePath: FsTypes.PathLike,
    ...args: unknown[]
  ) => {
    if (isManifestPath(filePath)) {
      const stream = createDiscardWriteStream()
      stream.path = String(filePath)

      return stream as unknown as ReturnType<typeof fs.createWriteStream>
    }

    return (originalCreateWriteStream as (...a: unknown[]) => unknown)(
      filePath,
      ...args
    )
  }) as typeof fs.createWriteStream

  // Read opens must pass through: redirecting them hands empty /dev/null
  // content to any in-process reader of the guarded manifest.
  const writeIntentFlagMask =
    fs.constants.O_WRONLY |
    fs.constants.O_RDWR |
    fs.constants.O_APPEND |
    fs.constants.O_CREAT |
    fs.constants.O_TRUNC

  const isWriteIntentOpen = (flags: unknown): boolean => {
    if (typeof flags === 'string') return /[wa+]/.test(flags)
    if (typeof flags === 'number') return (flags & writeIntentFlagMask) !== 0

    return false
  }

  const originalOpen = guardedFs.open.bind(guardedFs)
  guardedFs.open = ((
    pathLike: FsTypes.PathLike,
    flags: unknown,
    ...args: unknown[]
  ) => {
    const nextPath =
      isManifestPath(pathLike) && isWriteIntentOpen(flags)
        ? os.devNull
        : pathLike

    return (originalOpen as (...a: unknown[]) => unknown)(
      nextPath,
      flags,
      ...args
    )
  }) as typeof fs.open

  const originalOpenSync = guardedFs.openSync.bind(guardedFs)
  guardedFs.openSync = ((
    pathLike: FsTypes.PathLike,
    flags: unknown,
    ...args: unknown[]
  ) => {
    const nextPath =
      isManifestPath(pathLike) && isWriteIntentOpen(flags)
        ? os.devNull
        : pathLike

    return (originalOpenSync as (...a: unknown[]) => unknown)(
      nextPath,
      flags,
      ...args
    )
  }) as typeof fs.openSync

  const originalRename = guardedFs.rename.bind(guardedFs)
  guardedFs.rename = ((
    oldPath: FsTypes.PathLike,
    newPath: FsTypes.PathLike,
    callback: unknown
  ) => {
    if (isManifestPath(newPath) && !allowManifestRename(oldPath, newPath)) {
      if (typeof callback === 'function') callback(null)

      return
    }

    return originalRename(oldPath, newPath, callback as FsTypes.NoParamCallback)
  }) as typeof fs.rename

  const originalRenameSync = guardedFs.renameSync.bind(guardedFs)
  guardedFs.renameSync = ((
    oldPath: FsTypes.PathLike,
    newPath: FsTypes.PathLike
  ) => {
    if (isManifestPath(newPath) && !allowManifestRename(oldPath, newPath)) {
      return
    }

    return originalRenameSync(oldPath, newPath)
  }) as typeof fs.renameSync

  let originalPromiseWriteFile: typeof fs.promises.writeFile | undefined

  if (guardedFs.promises?.writeFile) {
    originalPromiseWriteFile = guardedFs.promises.writeFile.bind(
      guardedFs.promises
    ) as typeof fs.promises.writeFile

    guardedFs.promises.writeFile = (async (
      filePath: unknown,
      ...args: unknown[]
    ) => {
      if (isManifestPath(filePath)) return

      return (originalPromiseWriteFile as (...a: unknown[]) => unknown)(
        filePath,
        ...args
      )
    }) as typeof fs.promises.writeFile
  }

  // The last uninstall restores the pristine fs surface so a long-lived
  // host process is not left with patched globals after every server stops.
  restoreManifestDiskWriteGuardPatches = () => {
    guardedFs.writeFile = originalWriteFile as typeof fs.writeFile
    guardedFs.writeFileSync = originalWriteFileSync as typeof fs.writeFileSync
    guardedFs.createWriteStream =
      originalCreateWriteStream as typeof fs.createWriteStream

    guardedFs.open = originalOpen as typeof fs.open
    guardedFs.openSync = originalOpenSync as typeof fs.openSync
    guardedFs.rename = originalRename as typeof fs.rename
    guardedFs.renameSync = originalRenameSync as typeof fs.renameSync

    if (originalPromiseWriteFile) {
      guardedFs.promises.writeFile = originalPromiseWriteFile
    }
  }

  isManifestDiskWriteGuardInstalled = true

  return uninstall
}

// Plain manifest+scripts extensions ship no project manifest; the project root
// is then the manifest's directory. Deno projects anchor on deno.json(c).
export function resolveDevProjectRoot(
  projectStructure: Pick<
    ProjectStructure,
    'manifestPath' | 'packageJsonPath' | 'denoJsonPath'
  >
): string {
  const {manifestPath, packageJsonPath, denoJsonPath} = projectStructure
  const projectManifestPath = packageJsonPath || denoJsonPath

  return projectManifestPath
    ? path.dirname(projectManifestPath)
    : path.dirname(manifestPath)
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
    release: null,
    lifecycle: null
  }

  try {
    await startDevSession(projectStructure, devOptions, startup)
  } catch (error) {
    if (!startup.started) {
      frameFailedStart(error, startup.lifecycle, projectStructure, devOptions)

      // A session that never started leaves nothing in a host that goes on:
      // no listener, no port, no open file, no guard on the manifest.
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
  // Set while a bundle is being built, for a build that throws partway.
  let releaseUnfinishedBundle: (() => void) | null = null

  let closeControlBridge: () => Promise<void> = async () => {}

  let firstServer: {stop?: () => Promise<void>} = {}
  const holdings = createSessionHoldings()

  startup.release = async () => {
    // A bundle that threw partway has no server to stop it.
    const releaseBundle = releaseUnfinishedBundle
    releaseUnfinishedBundle = null

    try {
      releaseBundle?.()
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

  const projectConfig = await loadProjectConfigDefaults(packageJsonDir)
  const commandConfig = await loadCommandConfig(packageJsonDir, 'dev')
  const browserConfig = await loadBrowserConfig(
    packageJsonDir,
    devOptions.browser
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
    readyAwaitsExecutor,
    port: portAllocation.port,
    output: {
      clean: false,
      path: primaryDistPath
    }
  }

  const manifestOutputPath = path.join(primaryDistPath, 'manifest.json')

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

  // One schema-1 frame per lifecycle transition, on stdout, only when the
  // command layer asked for machine output (EXTENSION_OUTPUT=ndjson).
  const lifecycle = createLifecycleStream({
    command: 'dev',
    browser: browserName,
    distPath: primaryDistPath,
    readyPath: metadata.readyPath,
    eventsPath: metadata.eventsPath,
    noBrowser: Boolean(devOptions.noBrowser),
    hintFor: devOptions.hintFor
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
    const configResolved = await loadConfigResolvedHook(packageJsonDir)

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

    const uninstallManifestGuard =
      installManifestDiskWriteGuard(manifestOutputPath)
    releaseUnfinishedBundle = uninstallManifestGuard

    // Under --no-browser no CDP controller owns reload, so broadcast the same
    // classified reload decision over the control bridge; gated to avoid double-reload.
    if (!extendedOptions.browsersPlugin && compiler?.hooks?.watchRun) {
      const changedSources = createChangedSourcesTracker(compiler)
      let isFirstBridgeCompile = true
      // The browser the user runs keeps the manifest it loaded as much as a
      // launched one does, so a renamed bundle or rewritten sheet counts here.
      const loadedContentScripts = isEmulatorBrowser(browserName)
        ? undefined
        : createLoadedContentScripts({
            refreshInPlace: isGeckoBasedBrowser(browserName)
          })

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

          const outputPath = String(compilation.options?.output?.path || '')
          const contextDir = String(compilation.options?.context || '')
          const {forcedFull, changedSources: sources} =
            changedSources.snapshot()
          const classified = classifyReloadFromSources({
            changedSources: sources,
            forcedFull,
            getContentScriptCount: () =>
              readContentScriptCount(compilation, outputPath),
            getSourceFeatureIndex: () =>
              buildSourceFeatureIndex(compilation, contextDir),
            outputPath,
            contextDir
          })
          const instruction = loadedContentScripts
            ? loadedContentScripts.resolve(compilation, classified)
            : classified

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
    attachLifecycleStream(compiler, lifecycle)

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

    // The fs guard is process-global; a stopped server must release its path
    // or later in-process writers to this dist are silently swallowed.
    if (typeof server.stop === 'function') {
      const originalDevServerStop = server.stop.bind(server)

      server.stop = async () => {
        try {
          await originalDevServerStop()
        } finally {
          uninstallManifestGuard()
        }
      }
    }

    releaseUnfinishedBundle = null
    compilerByServer.set(server, compiler)

    return {compiler, server, firstCompile}
  }

  const createRestartBundle = () =>
    buildRestartBundle({
      build: () => createCompilerAndServer({isRestart: true}),
      activeCompiler: () => activeCompiler,
      setActiveCompiler: (compiler) => {
        activeCompiler = compiler
      },
      takeUnfinishedRelease: () => {
        const release = releaseUnfinishedBundle
        releaseUnfinishedBundle = null

        return release
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
  startup.started = true

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
  const stopLaunchFailureWatch = lifecycle.watchBrowserLaunchFailure(
    1000,
    (ready) => {
      metadata.appendEvent({
        type: 'browser_launch_failed',
        ts: new Date().toISOString(),
        command: 'dev',
        browser: browserName,
        browserLaunchFailedAt: String(ready.browserLaunchFailedAt),
        reason:
          typeof ready.browserLaunchFailedReason === 'string'
            ? ready.browserLaunchFailedReason
            : undefined
      })
    }
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
      }
    }
  )
  holdings.addForRelease(disposeCleanupHandlers)

  // A host that knows the session cannot go on ends it through here, so the
  // one terminal frame is the stream's own and the shutdown is the usual one.
  holdings.addEarly(
    registerLiveSession((code, message) => {
      lifecycle.failed(message, code)
      void disposeCleanupHandlers.endAsFailed()
    })
  )
}
