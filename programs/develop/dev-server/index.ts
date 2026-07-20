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
import * as path from 'node:path'
import {Writable} from 'node:stream'
import {rspack, type Stats} from '@rspack/core'
import {type Configuration, RspackDevServer} from '@rspack/dev-server'
import {merge} from 'webpack-merge'
import {
  loadBrowserConfig,
  loadCommandConfig,
  loadCustomConfig
} from '../lib/config-loader'
import {isGeckoBasedBrowser} from '../lib/constants'
import {asAbsolute, getDistPath} from '../lib/paths'
import type {ProjectStructure} from '../lib/project'
import {sanitize} from '../lib/sanitize'
import {
  ensureSessionArtifactsIgnoreFile,
  actionsPath as sessionActionsPath,
  logsPath as sessionLogsPath
} from '../lib/session-paths'
import type {BrowserLogSinkEvent} from '../plugin-browsers'
import {createPlaywrightMetadataWriter} from '../plugin-playwright'
import {
  buildSourceFeatureIndex,
  classifyReloadFromSources,
  createChangedSourcesTracker,
  dispatchReload,
  readContentScriptCount
} from '../plugin-reload'
import {resolveCompanionExtensionsConfig} from '../plugin-special-folders/folder-extensions/resolve-config'
import {getSpecialFoldersDataForProjectRoot} from '../plugin-special-folders/get-data'
import webpackConfig from '../rspack-config'
import type {DevOptions} from '../types'
import {setupCleanupHandlers} from './cleanup'
import {
  setupCompilerLifecycleHooks,
  setupNoBrowserBannerOnFirstDone
} from './compiler-hooks'
import {resolveConnectableHost} from './connectable-host'
import {ActionsFileWriter} from './control-bridge/actions-file'
import {BridgeBroker} from './control-bridge/broker'
import {CONTROL_WS_PATH, LOG_EVENT_VERSION} from './control-bridge/contracts'
import {
  controlPortFilePath,
  legacyControlPortFilePath,
  readPersistedControlPort,
  writePersistedControlPort
} from './control-bridge/control-port-store'
import {LogsFileWriter} from './control-bridge/logs-file'
import {LogRingBuffer} from './control-bridge/ring-buffer'
import {
  clearControlToken,
  writeControlToken
} from './control-bridge/session-token'
import {startControlServer} from './control-bridge/ws-control-server'
import {isUsingJSFramework} from './frameworks'
import * as messages from './messages'
import {PortManager} from './port-manager'

function shouldWriteAssetToDisk(filePath: string) {
  // A `..` segment means an emitted asset NAME escapes the output dir; writing
  // it would clobber a SOURCE file and start a self-feeding recompile loop.
  if (/(?:^|[/\\])\.\.(?:[/\\]|$)/.test(filePath)) return false
  return !/(?:^|[/\\])manifest\.json$/i.test(filePath)
}

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

const guardedManifestDiskWritePaths = new Set<string>()
let isManifestDiskWriteGuardInstalled = false

function hasGuardedManifestDiskPath(filePath: unknown) {
  if (typeof filePath !== 'string') return false

  const resolvedPath = path.resolve(filePath)
  for (const guardedPath of guardedManifestDiskWritePaths) {
    if (isSamePath(guardedPath, resolvedPath)) return true
  }

  return false
}

interface GuardableOutputFs {
  __extensionjsManifestWriteGuard?: boolean
  writeFile?: (filePath: string, ...args: unknown[]) => unknown
  writeFileSync?: (filePath: string, ...args: unknown[]) => unknown
  createWriteStream?: (filePath: string, ...args: unknown[]) => unknown
  promises?: {writeFile?: (filePath: string, ...args: unknown[]) => unknown}
}

function suppressManifestOutputWrites(
  compiler: unknown,
  manifestOutputPath: string
) {
  const outputFileSystem = (
    compiler as {outputFileSystem?: unknown} | undefined
  )?.outputFileSystem as GuardableOutputFs | undefined
  if (!outputFileSystem || outputFileSystem.__extensionjsManifestWriteGuard) {
    return
  }

  const isManifestPath = (filePath: unknown) =>
    typeof filePath === 'string' && isSamePath(filePath, manifestOutputPath)

  if (typeof outputFileSystem.writeFile === 'function') {
    const originalWriteFile = outputFileSystem.writeFile.bind(outputFileSystem)
    outputFileSystem.writeFile = (filePath: string, ...args: unknown[]) => {
      if (isManifestPath(filePath)) {
        const callback = args[args.length - 1]

        if (typeof callback === 'function') callback(null)

        return
      }

      return originalWriteFile(filePath, ...args)
    }
  }

  if (typeof outputFileSystem.writeFileSync === 'function') {
    const originalWriteFileSync =
      outputFileSystem.writeFileSync.bind(outputFileSystem)
    outputFileSystem.writeFileSync = (filePath: string, ...args: unknown[]) => {
      if (isManifestPath(filePath)) return

      return originalWriteFileSync(filePath, ...args)
    }
  }

  if (typeof outputFileSystem.createWriteStream === 'function') {
    const originalCreateWriteStream =
      outputFileSystem.createWriteStream.bind(outputFileSystem)
    outputFileSystem.createWriteStream = (
      filePath: string,
      ...args: unknown[]
    ) => {
      if (isManifestPath(filePath)) {
        const stream = createDiscardWriteStream()
        stream.path = filePath

        return stream
      }

      return originalCreateWriteStream(filePath, ...args)
    }
  }

  if (typeof outputFileSystem?.promises?.writeFile === 'function') {
    const originalPromiseWriteFile = outputFileSystem.promises.writeFile.bind(
      outputFileSystem.promises
    )
    outputFileSystem.promises.writeFile = async (
      filePath: string,
      ...args: unknown[]
    ) => {
      if (isManifestPath(filePath)) return

      return originalPromiseWriteFile(filePath, ...args)
    }
  }

  outputFileSystem.__extensionjsManifestWriteGuard = true
}

function installManifestDiskWriteGuard(manifestOutputPath: string) {
  const guardKey = path.resolve(manifestOutputPath)
  guardedManifestDiskWritePaths.add(guardKey)
  if (isManifestDiskWriteGuardInstalled) return

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

  const originalOpen = guardedFs.open.bind(guardedFs)
  guardedFs.open = ((
    pathLike: FsTypes.PathLike,
    flags: unknown,
    ...args: unknown[]
  ) => {
    const nextPath = isManifestPath(pathLike) ? '/dev/null' : pathLike
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
    const nextPath = isManifestPath(pathLike) ? '/dev/null' : pathLike
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
    if (isManifestPath(newPath) && !allowManifestRename(oldPath, newPath))
      return
    return originalRenameSync(oldPath, newPath)
  }) as typeof fs.renameSync

  if (guardedFs.promises?.writeFile) {
    const originalPromiseWriteFile = guardedFs.promises.writeFile.bind(
      guardedFs.promises
    )
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

  isManifestDiskWriteGuardInstalled = true
}

export async function devServer(
  projectStructure: ProjectStructure,
  devOptions: DevOptions
) {
  // CLI-only extras that ride along on DevOptions without being part of the
  // public options contract.
  const extendedOptions = devOptions as DevOptions & {
    publicHost?: string
    allowControl?: boolean
    allowEval?: boolean
    authorMode?: boolean
    browsersPlugin?: {
      setReloadBroker?: (broker: unknown) => void
      setLogSink?: (sink: (event: BrowserLogSinkEvent) => void) => void
    }
  }
  process.env.EXTENSION_BROWSER_LAUNCH_ENABLED = devOptions.noBrowser
    ? '0'
    : '1'

  const {manifestPath, packageJsonPath, denoJsonPath} = projectStructure
  // Plain manifest+scripts extensions ship no project manifest; the project root
  // is then the manifest's directory. Deno projects anchor on deno.json(c).
  const projectManifestPath = packageJsonPath || denoJsonPath
  const packageJsonDir = projectManifestPath
    ? path.dirname(projectManifestPath)
    : path.dirname(manifestPath)

  const commandConfig = await loadCommandConfig(packageJsonDir, 'dev')
  const browserConfig = await loadBrowserConfig(
    packageJsonDir,
    devOptions.browser
  )

  // Probe on the same host the server binds, so a port free on localhost but
  // taken on the configured host isn't picked (and vice versa).
  const portManager = new PortManager(8080)
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
  process.env.EXTENSION_DEV_SERVER_PROTOCOL = devServerWebSocketURL.protocol
  process.env.EXTENSION_DEV_SERVER_HOST = devServerHost
  process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST = connectableHost
  process.env.EXTENSION_DEV_SERVER_PORT = String(port)
  process.env.EXTENSION_DEV_SERVER_PATH = '/ws'

  const browserName = String(devOptions.browser || 'chromium')
  // One canonical dist output path per browser, shared with `build`/`preview`.
  // Inline `dist/<browser>` joins let output/manifest/ready.json paths drift.
  const primaryDistPath = getDistPath(asAbsolute(packageJsonDir), browserName)
  const bridgeLogsAbsPath = sessionLogsPath(packageJsonDir, browserName)
  // The session root self-ignores so a project with no .gitignore can't
  // commit the managed profile (cookies/logins) or session logs.
  ensureSessionArtifactsIgnoreFile(packageJsonDir)
  // The ready contract publishes it project-relative.
  const bridgeLogsRelPath = path.relative(packageJsonDir, bridgeLogsAbsPath)
  const bridgeLogFile = new LogsFileWriter({
    filePath: bridgeLogsAbsPath,
    runId: currentInstance.instanceId
  })

  const allowControl = Boolean(extendedOptions.allowControl)
  const allowEval = Boolean(extendedOptions.allowEval)
  const authorMode =
    Boolean(extendedOptions.authorMode) ||
    process.env.EXTENSION_AUTHOR_MODE === 'development'
  const bridgeActionsFile = allowControl
    ? new ActionsFileWriter({
        filePath: sessionActionsPath(packageJsonDir, browserName)
      })
    : undefined

  // The eval token is written 0600 OUTSIDE dist/ only when eval is enabled.
  const bridgeControlToken =
    allowControl && allowEval
      ? writeControlToken(packageJsonDir, browserName)
      : undefined
  // The metadata writer is created later (it needs the resolved control port);
  // the SW connects after that, so a mutable holder bridges the ordering.
  let stampExecutorAttached: (() => void) | undefined
  const bridgeBroker = new BridgeBroker({
    instanceId: currentInstance.instanceId,
    runId: currentInstance.instanceId,
    engine: isGeckoBasedBrowser(browserName) ? 'firefox' : 'chromium',
    ring: new LogRingBuffer(),
    file: bridgeLogFile,
    allowControl,
    allowEval,
    controlToken: bridgeControlToken,
    actions: bridgeActionsFile,
    authorMode,
    onExecutorAttached: () => stampExecutorAttached?.()
  })

  // Hand the broker to a launched runner plugin so Chromium reloads through the
  // SW producer (same executor as --no-browser). No-op for Safari and Firefox.
  const launchedPlugin = extendedOptions.browsersPlugin
  if (launchedPlugin && typeof launchedPlugin.setReloadBroker === 'function') {
    launchedPlugin.setReloadBroker(bridgeBroker)
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
          runId: currentInstance.instanceId
        })
      } catch {
        // Best-effort: a log-pipeline hiccup must never break the launch path.
      }
    })
  }

  let bridgeControlPort: number | null = null

  try {
    bridgeLogFile.start()
    bridgeActionsFile?.start()

    // Prefer the previous session's port: a reused profile may still run a CACHED
    // SW with it baked in, and only a reachable server can tell it to resync.
    const controlPortFile = controlPortFilePath(packageJsonDir, browserName)
    const preferredControlPort =
      readPersistedControlPort(controlPortFile) ??
      // Pre-fix sessions persisted the port under dist/; honor it once so a
      // profile whose cached SW has that port baked in can still resync.
      readPersistedControlPort(
        legacyControlPortFilePath(packageJsonDir, browserName)
      )

    let controlServer: Awaited<ReturnType<typeof startControlServer>>
    try {
      controlServer = await startControlServer({
        broker: bridgeBroker,
        host: devServerHost,
        port: preferredControlPort ?? 0
      })
    } catch (error) {
      if (preferredControlPort == null) throw error
      controlServer = await startControlServer({
        broker: bridgeBroker,
        host: devServerHost
      })
    }
    bridgeControlPort = controlServer.port
    writePersistedControlPort(controlPortFile, controlServer.port)
  } catch {
    // Control port could not bind; the dev server still runs without the bridge.
    try {
      bridgeLogFile.close()
    } catch {}
  }

  // Expose control-channel coordinates to the compiler (same process) so the
  // bridge-producer injector can bake them into the background SW
  process.env.EXTENSION_INSTANCE_ID = currentInstance.instanceId
  process.env.EXTENSION_CONTROL_PORT =
    bridgeControlPort != null ? String(bridgeControlPort) : ''

  // Flush buffered logs on process exit (interval flush handles the steady state).
  process.once('exit', () => {
    try {
      bridgeLogFile.close()
    } catch {}
    try {
      bridgeActionsFile?.close()
    } catch {}
    // Never leave a usable eval token behind after the session ends.
    if (bridgeControlToken) {
      clearControlToken(packageJsonDir, browserName)
    }
  })

  // Get the user defined args and merge with the Extension.js base webpack config
  // Avoid overriding file-config values with undefined from CLI args
  const safeBrowserConfig = sanitize(browserConfig)
  const safeCommandConfig = sanitize(commandConfig)
  const safeDevOptions = sanitize(devOptions)
  const specialFoldersData = getSpecialFoldersDataForProjectRoot(packageJsonDir)

  const mergedExtensionsConfig =
    safeDevOptions.extensions ??
    safeCommandConfig.extensions ??
    safeBrowserConfig.extensions ??
    specialFoldersData.extensions
  const resolvedExtensionsConfig = await resolveCompanionExtensionsConfig({
    projectRoot: packageJsonDir,
    browser: devOptions.browser,
    config: mergedExtensionsConfig
  })

  const baseConfig = webpackConfig(projectStructure, {
    ...safeBrowserConfig,
    ...safeCommandConfig,
    ...safeDevOptions,
    extensions: resolvedExtensionsConfig,
    browser: devOptions.browser,
    mode: 'development',
    instanceId: currentInstance.instanceId,
    controlPort: bridgeControlPort,
    controlPath: CONTROL_WS_PATH,
    logsPath: bridgeLogsRelPath,
    port: portAllocation.port,
    output: {
      clean: false,
      path: primaryDistPath
    }
  })

  const customWebpackConfig = await loadCustomConfig(packageJsonDir)
  const finalConfig = customWebpackConfig(baseConfig)

  const compilerConfig = merge(finalConfig, {})

  const compiler = rspack(compilerConfig)
  const manifestOutputPath = path.join(primaryDistPath, 'manifest.json')
  installManifestDiskWriteGuard(manifestOutputPath)
  suppressManifestOutputWrites(compiler, manifestOutputPath)

  // Under --no-browser no CDP controller owns reload, so broadcast the same
  // classified reload decision over the control bridge; gated to avoid double-reload.
  if (!extendedOptions.browsersPlugin && compiler?.hooks?.watchRun) {
    const changedSources = createChangedSourcesTracker(compiler)
    let isFirstBridgeCompile = true

    compiler.hooks.done.tapPromise(
      'extjs-no-browser-reload',
      async (stats: Stats) => {
        const compilation = stats.compilation
        if (compilation.errors && compilation.errors.length > 0) return

        // Skip the first compile: it's the initial build, not a change, and the
        // SW producer hasn't connected yet anyway.
        if (isFirstBridgeCompile) {
          isFirstBridgeCompile = false
          return
        }

        const outputPath = String(compilation.options?.output?.path || '')
        const contextDir = String(compilation.options?.context || '')
        const {forcedFull, changedSources: sources} = changedSources.snapshot()
        const instruction = classifyReloadFromSources({
          changedSources: sources,
          forcedFull,
          getContentScriptCount: () =>
            readContentScriptCount(compilation, outputPath),
          getSourceFeatureIndex: () =>
            buildSourceFeatureIndex(compilation, contextDir),
          outputPath
        })

        // Same shared dispatch seam as the launched path, here with the broker
        // (SW producer) as the executor. Honors EXTENSION_NO_RELOAD.
        await dispatchReload(instruction, {broker: bridgeBroker})
      }
    )
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
    controlPort: bridgeControlPort,
    controlPath: CONTROL_WS_PATH,
    logsPath: bridgeLogsRelPath
  })
  stampExecutorAttached = () => metadata.stampExecutorAttached()

  // Surface invalidation/fatal startup diagnostics during startup. Done-hook
  // warning/error output is registered earlier so it prints before launch hooks.
  setupCompilerLifecycleHooks(compiler)

  if (devOptions.noBrowser) {
    setupNoBrowserBannerOnFirstDone({
      compiler,
      browser: String(devOptions.browser || 'chromium'),
      manifestPath,
      readyPath: metadata.readyPath
    })
  }

  // Say so when the requested port was taken. Compare numerically: a CLI
  // --port arrives as a string, and '55835' !== 55835 misreported every run.
  const requestedPort = Number(devOptions.port)
  if (Number.isFinite(requestedPort) && requestedPort !== port) {
    console.log(messages.portInUse(requestedPort, port))
  }

  const serverConfig: Configuration = {
    host: devServerHost,
    allowedHosts: 'all',
    static: {
      directory: path.join(packageJsonDir, 'public'),
      watch: false
    },
    compress: false,
    devMiddleware: {
      // Manifest writes must stay atomic; let the manifest plugin own disk
      // persistence so Chromium never reads an in-place truncated file.
      writeToDisk: shouldWriteAssetToDisk,
      stats: {all: false}
    },
    watchFiles: {
      paths: [
        path.join(packageJsonDir, 'public', '**/*'),
        ...(isUsingJSFramework(packageJsonDir)
          ? []
          : [path.join(packageJsonDir, '**/*.html')])
      ],
      options: {
        // Prevent startup self-rebuild: initial emit writes dist/**/*.html.
        // Those generated files must not be treated as source watch inputs.
        ignored: [path.join(packageJsonDir, 'dist', '**/*')],
        // Avoid a startup recompile caused by chokidar "add" events for
        // existing files in watched folders.
        ignoreInitial: true,
        // Native FS events by default: polling wakes the CPU and adds HMR latency.
        // EXTENSION_WATCH_POLL opts into polling where native events are unreliable.
        ...(process.env.EXTENSION_WATCH_POLL === 'true'
          ? {
              usePolling: true,
              interval: parseInt(
                String(process.env.EXTENSION_WATCH_POLL_INTERVAL || '1000'),
                10
              )
            }
          : {})
      }
    },
    client: false,
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    port,
    // Rspack must inject `module.hot` so `@rspack/core/hot/dev-server` does not
    // throw; content bundles strip HMR startup, so liveReload cannot loop them.
    hot: true,
    liveReload: true
  }

  const devServer = new RspackDevServer(serverConfig, compiler)

  const START_TIMEOUT_MS = parseInt(
    String(process.env.EXTENSION_START_TIMEOUT_MS || '30000'),
    10
  )
  let startTimeout: NodeJS.Timeout | undefined

  try {
    startTimeout = setTimeout(() => {
      console.error(messages.devServerStartTimeout(START_TIMEOUT_MS))
    }, START_TIMEOUT_MS)

    await devServer.start()

    if (startTimeout) clearTimeout(startTimeout)
  } catch (error) {
    if (startTimeout) clearTimeout(startTimeout)

    metadata.writeError(
      'dev_server_start_failed',
      error instanceof Error ? error.message : String(error)
    )

    console.log(messages.extensionJsRunnerError(error))
    process.exit(1)
  }

  setupCleanupHandlers(devServer, portManager)
}
