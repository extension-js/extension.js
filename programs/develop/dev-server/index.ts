// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {rspack} from '@rspack/core'
import {type Configuration, RspackDevServer} from '@rspack/dev-server'
import type * as FsTypes from 'fs'
import fs from 'fs'
import * as path from 'path'
import {Writable} from 'stream'
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
  actionsPath as sessionActionsPath,
  logsPath as sessionLogsPath
} from '../lib/session-paths'
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
import {CONTROL_WS_PATH} from './control-bridge/contracts'
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
  // A `..` segment in the write target means an emitted asset NAME escapes
  // the output dir (dist/chromium/../../assets/x). Writing it would clobber
  // a SOURCE file, which the watcher then reports as a user edit — a
  // self-feeding recompile loop that reloads the extension once per second.
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

function suppressManifestOutputWrites(
  compiler: any,
  manifestOutputPath: string
) {
  const outputFileSystem = compiler?.outputFileSystem as any
  if (!outputFileSystem || outputFileSystem.__extensionjsManifestWriteGuard) {
    return
  }

  const isManifestPath = (filePath: unknown) =>
    typeof filePath === 'string' && isSamePath(filePath, manifestOutputPath)

  if (typeof outputFileSystem.writeFile === 'function') {
    const originalWriteFile = outputFileSystem.writeFile.bind(outputFileSystem)
    outputFileSystem.writeFile = (filePath: string, ...args: any[]) => {
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
    outputFileSystem.writeFileSync = (filePath: string, ...args: any[]) => {
      if (isManifestPath(filePath)) return

      return originalWriteFileSync(filePath, ...args)
    }
  }

  if (typeof outputFileSystem.createWriteStream === 'function') {
    const originalCreateWriteStream =
      outputFileSystem.createWriteStream.bind(outputFileSystem)
    outputFileSystem.createWriteStream = (filePath: string, ...args: any[]) => {
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
      ...args: any[]
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
    ...args: any[]
  ) => {
    if (isManifestPath(filePath)) {
      const callback = args[args.length - 1]
      if (typeof callback === 'function') callback(null)
      return
    }

    return (originalWriteFile as any)(filePath, ...args)
  }) as typeof fs.writeFile

  const originalWriteFileSync = guardedFs.writeFileSync.bind(guardedFs)
  guardedFs.writeFileSync = ((
    filePath: FsTypes.PathOrFileDescriptor,
    ...args: any[]
  ) => {
    if (isManifestPath(filePath)) return
    return (originalWriteFileSync as any)(filePath, ...args)
  }) as typeof fs.writeFileSync

  const originalCreateWriteStream = guardedFs.createWriteStream.bind(guardedFs)
  guardedFs.createWriteStream = ((
    filePath: FsTypes.PathLike,
    ...args: any[]
  ) => {
    if (isManifestPath(filePath)) {
      const stream = createDiscardWriteStream()
      stream.path = String(filePath)
      return stream as any
    }

    return (originalCreateWriteStream as any)(filePath, ...args)
  }) as typeof fs.createWriteStream

  const originalOpen = guardedFs.open.bind(guardedFs)
  guardedFs.open = ((
    pathLike: FsTypes.PathLike,
    flags: any,
    ...args: any[]
  ) => {
    const nextPath = isManifestPath(pathLike) ? '/dev/null' : pathLike
    return (originalOpen as any)(nextPath, flags, ...args)
  }) as typeof fs.open

  const originalOpenSync = guardedFs.openSync.bind(guardedFs)
  guardedFs.openSync = ((
    pathLike: FsTypes.PathLike,
    flags: any,
    ...args: any[]
  ) => {
    const nextPath = isManifestPath(pathLike) ? '/dev/null' : pathLike
    return (originalOpenSync as any)(nextPath, flags, ...args)
  }) as typeof fs.openSync

  const originalRename = guardedFs.rename.bind(guardedFs)
  guardedFs.rename = ((
    oldPath: FsTypes.PathLike,
    newPath: FsTypes.PathLike,
    callback: any
  ) => {
    if (isManifestPath(newPath) && !allowManifestRename(oldPath, newPath)) {
      if (typeof callback === 'function') callback(null)
      return
    }

    return originalRename(oldPath, newPath, callback)
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
      ...args: any[]
    ) => {
      if (isManifestPath(filePath)) return
      return (originalPromiseWriteFile as any)(filePath, ...args)
    }) as typeof fs.promises.writeFile
  }

  isManifestDiskWriteGuardInstalled = true
}

export async function devServer(
  projectStructure: ProjectStructure,
  devOptions: DevOptions
) {
  process.env.EXTENSION_BROWSER_LAUNCH_ENABLED = devOptions.noBrowser
    ? '0'
    : '1'

  const {manifestPath, packageJsonPath, denoJsonPath} = projectStructure
  // Plain manifest+scripts extensions ship no project manifest; the project
  // root is then the manifest's directory. `build` already tolerates this
  // shape — dev must not crash on dirname(undefined). Deno projects anchor
  // on deno.json(c) when no package.json exists.
  const projectManifestPath = packageJsonPath || denoJsonPath
  const packageJsonDir = projectManifestPath
    ? path.dirname(projectManifestPath)
    : path.dirname(manifestPath)

  // Get command defaults from extension.config.js (located at project root)
  const commandConfig = await loadCommandConfig(packageJsonDir, 'dev')
  // Get browser defaults from extension.config.js (located at project root)
  const browserConfig = await loadBrowserConfig(
    packageJsonDir,
    devOptions.browser
  )

  // Initialize port manager and allocate a port for this instance. Probe on the
  // same host the server binds, so a port free on localhost but taken on the
  // configured host isn't picked (and vice versa).
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
  // — the in-page HMR ws and the SW control-bridge producer — must dial a
  // CONNECTABLE host instead: a wildcard bind address is not a valid client
  // target. Derive it once here and propagate it to the HMR client URL,
  // ready.json, and the baked producer (see resolveConnectableHost).
  const connectableHost = resolveConnectableHost(
    devServerHost,
    (devOptions as any).publicHost
  )

  const devServerWebSocketURL = {
    protocol: 'ws',
    hostname: connectableHost,
    port
  }
  process.env.EXTENSION_DEV_SERVER_PROTOCOL = devServerWebSocketURL.protocol
  process.env.EXTENSION_DEV_SERVER_HOST = devServerHost
  // Connectable host for in-browser clients (HMR ws + control-bridge producer).
  process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST = connectableHost
  process.env.EXTENSION_DEV_SERVER_PORT = String(port)
  process.env.EXTENSION_DEV_SERVER_PATH = '/ws'

  // --- Agent bridge (Slice 1): dedicated control WS + logs.ndjson ---
  // Best-effort and local-only. Runs alongside (never blocks) the dev server.
  const browserName = String(devOptions.browser || 'chromium')
  // One canonical dist output path per browser, shared with `build`/`preview`
  // (all three route through getDistPath). Re-joining `dist/<browser>` inline at
  // each use site let the rspack output, the manifest path, and the ready.json
  // `distPath` field drift apart across code paths/versions — the root of the
  // "distPath depends on how the CLI was resolved" report. Derive it once.
  const primaryDistPath = getDistPath(asAbsolute(packageJsonDir), browserName)
  const bridgeLogsAbsPath = sessionLogsPath(packageJsonDir, browserName)
  // The ready contract publishes it project-relative.
  const bridgeLogsRelPath = path.relative(packageJsonDir, bridgeLogsAbsPath)
  const bridgeLogFile = new LogsFileWriter({
    filePath: bridgeLogsAbsPath,
    runId: currentInstance.instanceId
  })

  const allowControl = Boolean((devOptions as any).allowControl)
  const allowEval = Boolean((devOptions as any).allowEval)
  const authorMode =
    Boolean((devOptions as any).authorMode) ||
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
  // The metadata writer is created later (it needs the resolved control port),
  // but the broker fires onExecutorAttached whenever the SW connects — which is
  // always after that. A mutable holder bridges the ordering.
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

  // Option B: hand the broker to a launched runner plugin so Chromium reloads
  // through the SW producer (the same executor as `--no-browser`). No-op for the
  // Safari plugin / Firefox (which has no setReloadBroker / keeps RDP).
  const launchedPlugin = (devOptions as any).browsersPlugin
  if (launchedPlugin && typeof launchedPlugin.setReloadBroker === 'function') {
    launchedPlugin.setReloadBroker(bridgeBroker)
  }

  let bridgeControlPort: number | null = null

  try {
    bridgeLogFile.start()
    bridgeActionsFile?.start()

    // Prefer the port of the previous session for this project+browser: a
    // reused profile can still be running a CACHED background SW with that
    // old port baked in, and only a reachable server can tell it to resync
    // (broker sends it a full-reload on the stale hello). Falls back to an
    // ephemeral port when the persisted one is taken (e.g. a concurrent
    // instance).
    const controlPortFile = controlPortFilePath(packageJsonDir, browserName)
    const preferredControlPort =
      readPersistedControlPort(controlPortFile) ??
      // Pre-fix sessions persisted the port under dist/; honor it once so a
      // profile whose cached SW has that port baked in can still resync.
      readPersistedControlPort(
        legacyControlPortFilePath(packageJsonDir, browserName)
      )

    let controlServer
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
    } catch {
      // ignore
    }
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
    } catch {
      // ignore
    }
    try {
      bridgeActionsFile?.close()
    } catch {
      // ignore
    }
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
    mode: 'development' as any,
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

  // Get webpack config defaults from extension.config.js
  const customWebpackConfig = await loadCustomConfig(packageJsonDir)
  const finalConfig = customWebpackConfig(baseConfig)

  // Use merge to combine the base config with the custom config.
  // This way if the user define properties we don't have a default for,
  // they will be included in the final config.
  const compilerConfig = merge(finalConfig, {})

  const compiler = rspack(compilerConfig)
  const manifestOutputPath = path.join(primaryDistPath, 'manifest.json')
  installManifestDiskWriteGuard(manifestOutputPath)
  suppressManifestOutputWrites(compiler, manifestOutputPath)

  // --- Controller-less reload-on-change (--no-browser / headless / remote) ---
  // When a CDP controller is present (launched browser) it owns reload, driving
  // granular content-script reinjection from the BrowsersPlugin `done` hook. The
  // `browsersPlugin` is absent under `--no-browser`, so nothing would otherwise
  // reload the extension on save. Here we tap the same compile lifecycle and
  // broadcast the SAME typed reload decision over the control bridge; the SW
  // producer self-reloads. The two paths converge on one classifier
  // (classifyReloadFromSources) so a given change reloads identically whether or
  // not a browser was launched. Gated on the absence of a runner plugin so the
  // launched (and Safari) paths never double-reload.
  if (!(devOptions as any).browsersPlugin && compiler?.hooks?.watchRun) {
    const changedSources = createChangedSourcesTracker(compiler)
    let isFirstBridgeCompile = true

    compiler.hooks.done.tapPromise(
      'extjs-no-browser-reload',
      async (stats: any) => {
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

        // Same shared dispatch seam as the launched path — here with the broker
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

  // Surface invalidation/fatal startup diagnostics during startup.
  // Done-hook warning/error output is registered earlier in CompilationPlugin
  // so it prints before browser launch hooks.
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
  // --port arrives as a string, and '55835' !== 55835 used to print
  // "port 55835 is in use; using 55835 instead" on every run.
  const requestedPort = Number(devOptions.port)
  if (Number.isFinite(requestedPort) && requestedPort !== port) {
    console.log(messages.portInUse(requestedPort, port))
  }

  // webpack-dev-server configuration
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
        // Default to native FS events (FSEvents/inotify): polling wakes the
        // CPU every interval and adds up to `interval`ms of HMR latency.
        // Opt into polling only where native events are unreliable (some
        // network shares, bind-mounted Docker volumes) via EXTENSION_WATCH_POLL
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
    // Rspack must inject `module.hot` so `@rspack/core/hot/dev-server` (prepended to
    // HTML entry chains in development) does not throw. Content scripts do not
    // rely on that client: StripContentScriptDevServerRuntime strips HMR startup
    // from `content_scripts/content-*.js` bundles, so re-enabling liveReload no
    // longer triggers content-script reload loops — and it is the only path
    // that delivers HTML-entry edits to already-open extension pages once
    // rspack 2.x stopped bumping stats.hash on asset-only rebuilds.
    hot: true,
    liveReload: true
  }

  const devServer = new RspackDevServer(serverConfig, compiler)

  // Startup watchdog to surface hangs
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

  // Setup cleanup handlers for graceful shutdown
  setupCleanupHandlers(devServer, portManager)
}
