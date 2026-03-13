// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {Writable} from 'stream'
import {rspack} from '@rspack/core'
import {RspackDevServer, Configuration} from '@rspack/dev-server'
import {merge} from 'webpack-merge'
import * as messages from './messages'
import {PortManager} from './port-manager'
import {isUsingJSFramework} from './frameworks'
import {type ProjectStructure} from '../webpack-lib/project'
import {
  loadBrowserConfig,
  loadCommandConfig,
  loadCustomWebpackConfig
} from '../webpack-lib/config-loader'
import {resolveCompanionExtensionsConfig} from '../feature-special-folders/folder-extensions/resolve-config'
import {getSpecialFoldersDataForProjectRoot} from '../feature-special-folders/get-data'
import {sanitize} from '../webpack-lib/sanitize'
import {
  setupCompilerLifecycleHooks,
  setupNoBrowserBannerOnFirstDone
} from './compiler-hooks'
import {setupCleanupHandlers} from './cleanup'
import {createPlaywrightMetadataWriter} from '../plugin-playwright'
import webpackConfig from '../webpack-config'
import type {DevOptions} from '../webpack-types'

function shouldWriteAssetToDisk(filePath: string) {
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

function suppressManifestOutputWrites(
  compiler: any,
  manifestOutputPath: string
) {
  const outputFileSystem = compiler?.outputFileSystem as any
  if (!outputFileSystem || outputFileSystem.__extensionjsManifestWriteGuard)
    return

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
  const guardedFs = fs as typeof fs & {
    __extensionjsManifestDiskWriteGuard?: Set<string>
  }

  if (!guardedFs.__extensionjsManifestDiskWriteGuard) {
    guardedFs.__extensionjsManifestDiskWriteGuard = new Set()
  }

  const guardKey = path.resolve(manifestOutputPath)
  if (guardedFs.__extensionjsManifestDiskWriteGuard.has(guardKey)) return

  const isManifestPath = (filePath: unknown) =>
    typeof filePath === 'string' && isSamePath(filePath, manifestOutputPath)

  const allowManifestRename = (fromPath: unknown, toPath: unknown) =>
    typeof fromPath === 'string' &&
    typeof toPath === 'string' &&
    isManifestPath(toPath) &&
    isManifestTempPath(fromPath)

  const originalWriteFile = guardedFs.writeFile.bind(guardedFs)
  guardedFs.writeFile = ((
    filePath: fs.PathOrFileDescriptor,
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
    filePath: fs.PathOrFileDescriptor,
    ...args: any[]
  ) => {
    if (isManifestPath(filePath)) return
    return (originalWriteFileSync as any)(filePath, ...args)
  }) as typeof fs.writeFileSync

  const originalCreateWriteStream = guardedFs.createWriteStream.bind(guardedFs)
  guardedFs.createWriteStream = ((filePath: fs.PathLike, ...args: any[]) => {
    if (isManifestPath(filePath)) {
      const stream = createDiscardWriteStream()
      stream.path = String(filePath)
      return stream as any
    }

    return (originalCreateWriteStream as any)(filePath, ...args)
  }) as typeof fs.createWriteStream

  const originalOpen = guardedFs.open.bind(guardedFs)
  guardedFs.open = ((pathLike: fs.PathLike, flags: any, ...args: any[]) => {
    const nextPath = isManifestPath(pathLike) ? '/dev/null' : pathLike
    return (originalOpen as any)(nextPath, flags, ...args)
  }) as typeof fs.open

  const originalOpenSync = guardedFs.openSync.bind(guardedFs)
  guardedFs.openSync = ((pathLike: fs.PathLike, flags: any, ...args: any[]) => {
    const nextPath = isManifestPath(pathLike) ? '/dev/null' : pathLike
    return (originalOpenSync as any)(nextPath, flags, ...args)
  }) as typeof fs.openSync

  const originalRename = guardedFs.rename.bind(guardedFs)
  guardedFs.rename = ((
    oldPath: fs.PathLike,
    newPath: fs.PathLike,
    callback: any
  ) => {
    if (isManifestPath(newPath) && !allowManifestRename(oldPath, newPath)) {
      if (typeof callback === 'function') callback(null)
      return
    }

    return originalRename(oldPath, newPath, callback)
  }) as typeof fs.rename

  const originalRenameSync = guardedFs.renameSync.bind(guardedFs)
  guardedFs.renameSync = ((oldPath: fs.PathLike, newPath: fs.PathLike) => {
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

  guardedFs.__extensionjsManifestDiskWriteGuard.add(guardKey)
}

export async function devServer(
  projectStructure: ProjectStructure,
  devOptions: DevOptions
) {
  process.env.EXTENSION_BROWSER_LAUNCH_ENABLED = devOptions.noBrowser
    ? '0'
    : '1'

  const {manifestPath, packageJsonPath} = projectStructure
  const manifestDir = path.dirname(manifestPath)
  const packageJsonDir = path.dirname(packageJsonPath!)

  // Get command defaults from extension.config.js (located at project root)
  const commandConfig = await loadCommandConfig(packageJsonDir, 'dev')
  // Get browser defaults from extension.config.js (located at project root)
  const browserConfig = await loadBrowserConfig(
    packageJsonDir,
    devOptions.browser
  )

  // Initialize port manager and allocate ports for this instance
  const portManager = new PortManager(devOptions.browser, packageJsonDir, 8080)
  const desiredPort =
    typeof devOptions.port === 'string'
      ? parseInt(devOptions.port, 10)
      : devOptions.port
  const portAllocation = await portManager.allocatePorts(
    devOptions.browser,
    packageJsonDir,
    desiredPort
  )

  const currentInstance = portManager.getCurrentInstance()

  if (!currentInstance) {
    throw new Error('Failed to create instance')
  }

  const port = portAllocation.port
  const devServerHost = '127.0.0.1'
  const devServerWebSocketURL = {
    protocol: 'ws',
    hostname: devServerHost,
    port
  }

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
    port: portAllocation.port,
    output: {
      clean: false,
      path: path.join(packageJsonDir, 'dist', devOptions.browser)
    }
  })

  // Get webpack config defaults from extension.config.js
  const customWebpackConfig = await loadCustomWebpackConfig(packageJsonDir)
  const finalConfig = customWebpackConfig(baseConfig)

  // Use merge to combine the base config with the custom config.
  // This way if the user define properties we don't have a default for,
  // they will be included in the final config.
  const compilerConfig = merge(finalConfig, {})

  // CRITICAL: Ensure the HMR client embedded in extension scripts uses our dev-server
  // host/port, not the current page's host/port (which can be e.g. localhost:8080).
  ;(compilerConfig as any).devServer = {
    ...((compilerConfig as any).devServer || {}),
    host: devServerHost,
    port,
    client: {
      ...(((compilerConfig as any).devServer || {}).client || {}),
      webSocketURL: {
        ...((((compilerConfig as any).devServer || {}).client || {})
          .webSocketURL || {}),
        ...devServerWebSocketURL
      }
    }
  }
  const compiler = rspack(compilerConfig)
  const manifestOutputPath = path.join(
    packageJsonDir,
    'dist',
    devOptions.browser,
    'manifest.json'
  )
  installManifestDiskWriteGuard(manifestOutputPath)
  suppressManifestOutputWrites(compiler, manifestOutputPath)

  const metadata = createPlaywrightMetadataWriter({
    packageJsonDir,
    browser: String(devOptions.browser || 'chromium'),
    command: 'dev',
    distPath: path.join(
      packageJsonDir,
      'dist',
      String(devOptions.browser || 'chromium')
    ),
    manifestPath,
    port
  })

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

  // Log port information only in verbose mode
  if (typeof devOptions.port !== 'undefined' && devOptions.port !== port) {
    console.log(messages.portInUse(devOptions.port as number, port))
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
      // Ensure no server-side stats spam leaks to users
      stats: false
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
        usePolling: true,
        interval: 1000
      }
    },
    client: {
      // Do not surface bundler/dev-server names to end users
      logging: 'none',
      progress: false,
      overlay: false,
      webSocketURL: devServerWebSocketURL
    },
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    port,
    // Use HMR "only" mode globally so the injected hot runtime does NOT hard-reload the page
    // when HMR can't apply updates (important for content scripts to avoid infinite reload loops).
    hot: 'only',
    // Keep liveReload enabled so extension pages can still recover via full reload
    // (we selectively disable hot for those pages via a dev-only runtime patch).
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
