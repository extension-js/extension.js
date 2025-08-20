// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as path from 'path'
import {rspack} from '@rspack/core'
import {RspackDevServer, Configuration} from '@rspack/dev-server'
import {merge} from 'webpack-merge'
import {DevOptions} from '../commands/commands-lib/config-types'
import webpackConfig from './webpack-config'
import {type ProjectStructure} from '../commands/commands-lib/get-project-path'
import * as utils from './lib/utils'
import {
  loadBrowserConfig,
  loadCommandConfig,
  loadCustomWebpackConfig
} from '../commands/commands-lib/get-extension-config'
import * as messages from './lib/messages'
import {PortManager} from './lib/port-manager'
import {setupAutoExit} from './lib/auto-exit'

function closeAll(devServer: RspackDevServer, portManager: PortManager) {
  devServer
    .stop()
    .then(async () => {
      // Terminate the current instance
      await portManager.terminateCurrentInstance()
      process.exit()
    })
    .catch(async (error) => {
      console.log(messages.extensionJsRunnerError(error))
      // Still try to terminate the instance
      await portManager.terminateCurrentInstance()
      process.exit(1)
    })
}

export async function devServer(
  projectStructure: ProjectStructure,
  devOptions: DevOptions
) {
  const {manifestPath, packageJsonPath} = projectStructure
  const manifestDir = path.dirname(manifestPath)
  const packageJsonDir = path.dirname(packageJsonPath)

  // Get command defaults from extension.config.js
  const commandConfig = await loadCommandConfig(manifestDir, 'dev')
  // Get browser defaults from extension.config.js
  const browserConfig = await loadBrowserConfig(manifestDir, devOptions.browser)

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
  const baseConfig = webpackConfig(projectStructure, {
    ...devOptions,
    ...commandConfig,
    ...browserConfig,
    mode: 'development',
    instanceId: currentInstance.instanceId,
    port: portAllocation.port,
    output: {
      clean: false,
      path: path.join(manifestDir, 'dist', devOptions.browser)
    }
  })

  // Get webpack config defaults from extension.config.js
  const customWebpackConfig = await loadCustomWebpackConfig(manifestDir)
  const finalConfig = customWebpackConfig(baseConfig)

  // Use merge to combine the base config with the custom config.
  // This way if the user define properties we don't have a default for,
  // they will be included in the final config.
  const compilerConfig = merge(finalConfig)
  const compiler = rspack(compilerConfig)

  // remove AI-focused NDJSON event stream hooks

  const port = portAllocation.port

  // Log port information
  if (typeof devOptions.port !== 'undefined' && devOptions.port !== port) {
    const requested =
      typeof devOptions.port === 'string'
        ? parseInt(devOptions.port, 10)
        : devOptions.port
    console.log(messages.portInUse(requested as number, port))
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
      writeToDisk: true
    },
    watchFiles: utils.isUsingJSFramework(manifestDir)
      ? undefined
      : {
          paths: [path.join(manifestDir, '**/*.html')],
          options: {
            usePolling: true,
            interval: 1000
          }
        },
    client: {
      logging: process.env.EXTENSION_ENV === 'development' ? 'error' : 'none',
      progress: false,
      overlay: false
    },
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    port,
    hot: true
  }

  const devServer = new RspackDevServer(serverConfig, compiler as any)

  devServer.startCallback(async (error) => {
    if (error != null) {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        console.log(messages.portInUse(port as number, port as number))
        process.exit(1)
      }
      console.log(messages.extensionJsRunnerError(error))
    }
  })

  // Handle process termination
  const cleanup = async () => {
    try {
      await closeAll(devServer, portManager)
    } catch (error) {
      console.error(messages.extensionJsRunnerCleanupError(error))
      process.exit(1)
    }
  }

  process.on('ERROR', cleanup)
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('SIGHUP', cleanup)

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    console.error(messages.extensionJsRunnerUncaughtException(error))
    await cleanup()
  })

  process.on('unhandledRejection', async (reason, promise) => {
    console.error(messages.extensionJsRunnerUnhandledRejection(promise, reason))
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

  process.removeAllListeners?.('SIGINT')
  process.removeAllListeners?.('SIGTERM')
  process.removeAllListeners?.('SIGHUP')
  process.removeAllListeners?.('ERROR')
  process.on('ERROR', cancelAndCleanup)
  process.on('SIGINT', cancelAndCleanup)
  process.on('SIGTERM', cancelAndCleanup)
  process.on('SIGHUP', cancelAndCleanup)
}
