// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import {rspack} from '@rspack/core'
import {RspackDevServer, Configuration} from '@rspack/dev-server'
import {merge} from 'webpack-merge'
import * as messages from './messages'
import {PortManager} from './port-manager'
import {setupAutoExit} from './auto-exit'
import {isUsingJSFramework} from './frameworks'
import {scrubBrand} from '../webpack-lib/branding'
import {type ProjectStructure} from '../webpack-lib/project'
import {
  loadBrowserConfig,
  loadCommandConfig,
  loadCustomWebpackConfig
} from '../webpack-lib/config-loader'
import webpackConfig from '../webpack-config'
import type {DevOptions} from '../webpack-types'
import * as devMessages from './messages'

function closeAll(devServer: RspackDevServer, portManager: PortManager) {
  devServer
    .stop()
    .then(async () => {
      // Terminate the current instance
      await portManager.terminateCurrentInstance()
      // Allow browser plugin signal handlers to complete cleanup
      setTimeout(() => process.exit(), 500)
    })
    .catch(async (error) => {
      console.log(messages.extensionJsRunnerError(error))
      // Still try to terminate the instance
      await portManager.terminateCurrentInstance()
      // Allow browser plugin signal handlers to complete cleanup
      setTimeout(() => process.exit(1), 500)
    })
}

export async function devServer(
  projectStructure: ProjectStructure,
  devOptions: DevOptions
) {
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

  // Get the user defined args and merge with the Extension.js base webpack config
  // Avoid overriding file-config values with undefined from CLI args
  const sanitize = <T extends Record<string, any>>(obj: T): Partial<T> =>
    Object.fromEntries(
      Object.entries(obj || {}).filter(([, v]) => typeof v !== 'undefined')
    ) as Partial<T>

  const safeBrowserConfig = sanitize(browserConfig)
  const safeCommandConfig = sanitize(commandConfig)
  const safeDevOptions = sanitize(devOptions)

  const baseConfig = webpackConfig(projectStructure, {
    ...safeBrowserConfig,
    ...safeCommandConfig,
    ...safeDevOptions,
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
  const customWebpackConfig = await loadCustomWebpackConfig(manifestDir)
  const finalConfig = customWebpackConfig(baseConfig)

  // Use merge to combine the base config with the custom config.
  // This way if the user define properties we don't have a default for,
  // they will be included in the final config.
  const compilerConfig = merge(finalConfig, {})
  const compiler = rspack(compilerConfig)

  // Surface bundler diagnostics during startup (even if start() hangs)
  const verbose = String(process.env.EXTENSION_VERBOSE || '').trim() === '1'
  let reportedNoEntries = false

  compiler.hooks.invalid.tap('extension.js:invalid', () => {
    if (verbose) {
      console.log(messages.bundlerRecompiling())
    }
  })

  compiler.hooks.failed.tap('extension.js:failed', (error: unknown) => {
    console.error(messages.bundlerFatalError(error))
  })

  compiler.hooks.done.tap('extension.js:done', (stats: any) => {
    try {
      if (stats?.hasErrors?.()) {
        const str = stats?.toString?.({
          colors: true,
          all: false,
          errors: true,
          warnings: true
        })
        if (str) console.error(scrubBrand(str))
      } else if (stats?.hasWarnings?.()) {
        const str = stats?.toString?.({
          colors: true,
          all: false,
          errors: false,
          warnings: true
        })

        if (str) console.warn(scrubBrand(str))
      }

      // Warn when nothing is being built on the first pass
      if (!reportedNoEntries) {
        const info = stats.toJson({
          all: false,
          assets: true,
          entrypoints: true
        })
        const hasAssets = Array.isArray(info?.assets) && info.assets.length > 0
        const entrypoints = info?.entrypoints || {}
        const hasEntrypoints =
          entrypoints && Object.keys(entrypoints).length > 0

        if (!hasAssets && !hasEntrypoints) {
          reportedNoEntries = true
          const hookPort = portAllocation.port
          console.warn(messages.noEntrypointsDetected(hookPort))
        }
      }
    } catch (error) {
      const str = stats?.toString({
        colors: true,
        all: false,
        errors: true,
        warnings: true
      })
      if (str) console.error(scrubBrand(str))
    }
  })

  const port = portAllocation.port

  // Log port information only in verbose mode
  if (typeof devOptions.port !== 'undefined' && devOptions.port !== port) {
    console.log(messages.portInUse(devOptions.port as number, port))
  }

  // webpack-dev-server configuration
  const serverConfig: Configuration = {
    host: '127.0.0.1',
    allowedHosts: 'all',
    static: {
      watch: {
        ignored: /\bnode_modules\b/
      }
    },
    compress: false,
    devMiddleware: {
      writeToDisk: true,
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
        usePolling: true,
        interval: 1000
      }
    },
    client: {
      // Do not surface bundler/dev-server names to end users
      logging: 'none',
      progress: false,
      overlay: false,
      webSocketURL: {
        protocol: 'ws',
        hostname: '127.0.0.1',
        port
      }
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

    console.log(messages.ready('development', devOptions.browser))
  } catch (error) {
    if (startTimeout) clearTimeout(startTimeout)

    console.log(messages.extensionJsRunnerError(error))
    process.exit(1)
  }

  // Handle process termination
  const cleanup = async () => {
    try {
      await closeAll(devServer, portManager)
    } catch (error) {
      console.error('[Extension.js Runner] Error during cleanup.', error)
      process.exit(1)
    }
  }

  process.on('ERROR', cleanup)
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('SIGHUP', cleanup)

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    console.error('[Extension.js Runner] Uncaught exception.', error)
    await cleanup()
  })

  process.on('unhandledRejection', async (reason, promise) => {
    console.error('[Extension.js Runner] Unhandled rejection.', promise, reason)
    await cleanup()
  })

  // Optional auto-exit support for non-interactive (AI/CI) runs
  const cancelAutoExit = setupAutoExit(
    process.env.EXTENSION_AUTO_EXIT_MS,
    process.env.EXTENSION_FORCE_KILL_MS,
    cleanup
  )

  // Ensure we clear timers before shutdown
  const cancelAndCleanup = async () => {
    try {
      cancelAutoExit()
    } catch {}
    await cleanup()
  }

  // Do not remove other listeners; let browser plugins receive signals too.
  // Register our cleanup alongside theirs so Ctrl+C terminates the browser.
  process.on('ERROR', cancelAndCleanup)
  process.on('SIGINT', cancelAndCleanup)
  process.on('SIGTERM', cancelAndCleanup)
  process.on('SIGHUP', cancelAndCleanup)
}
