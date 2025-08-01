// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝ ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

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
import * as messages from '../commands/commands-lib/messages'
import {PortManager} from './lib/port-manager'
import {DynamicExtensionManager} from '../lib/dynamic-extension-manager'

function closeAll(devServer: RspackDevServer, portManager: PortManager) {
  devServer
    .stop()
    .then(async () => {
      // Terminate the current instance
      await portManager.terminateCurrentInstance()
      process.exit()
    })
    .catch(async (error) => {
      console.log(`Error in the Extension.js runner: ${error.stack || ''}`)
      // Still try to terminate the instance
      await portManager.terminateCurrentInstance()
      process.exit(1)
    })
}

export async function devServer(
  projectStructure: ProjectStructure,
  devOptions: DevOptions
) {
  console.log('🔍 [devServer] called', {projectStructure, devOptions})
  const {manifestPath, packageJsonPath} = projectStructure
  const manifestDir = path.dirname(manifestPath)
  const packageJsonDir = path.dirname(packageJsonPath)

  // Get command defaults from extension.config.js
  const commandConfig = loadCommandConfig(manifestDir, 'dev')
  // Get browser defaults from extension.config.js
  const browserConfig = loadBrowserConfig(manifestDir, devOptions.browser)

  // Initialize port manager and allocate ports for this instance
  const portManager = new PortManager(devOptions.browser, packageJsonDir, 8080)
  const portAllocation = await portManager.allocatePorts(
    devOptions.browser,
    packageJsonDir,
    devOptions.port
  )

  // Initialize dynamic extension manager
  const extensionManager = new DynamicExtensionManager(packageJsonDir)
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
    output: {
      clean: false,
      path: path.join(manifestDir, 'dist', devOptions.browser)
    },
    instanceId: currentInstance.instanceId,
    port: portAllocation.port // Pass the allocated port to webpack config
  })

  // Get webpack config defaults from extension.config.js
  const customWebpackConfig = await loadCustomWebpackConfig(manifestDir)
  const finalConfig = customWebpackConfig(baseConfig)

  // Use merge to combine the base config with the custom config.
  // This way if the user define properties we don't have a default for,
  // they will be included in the final config.
  const compilerConfig = merge(finalConfig)
  const compiler = rspack(compilerConfig)

  const port = portAllocation.port

  // Log port information
  if (devOptions.port && devOptions.port !== port) {
    console.log(messages.portInUse(devOptions.port, port))
  }

  // Log instance information
  console.log(`🧩 Instance ${portAllocation.instanceId.slice(0, 8)} started`)
  console.log(`   Port: ${port}, WebSocket: ${portAllocation.webSocketPort}`)
  console.log(`   Manager Extension: ${devOptions.browser}-manager-${port}`)

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

  devServer.startCallback((error) => {
    if (error != null) {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        console.log(messages.portInUse(port as number, (port as number) + 1))
        process.exit(1)
      }
      console.log(`Error in the Extension.js runner: ${error.stack || ''}`)
    }
  })

  // Handle process termination
  const cleanup = async () => {
    try {
      await closeAll(devServer, portManager)
    } catch (error) {
      console.error('Error during cleanup:', error)
      process.exit(1)
    }
  }

  process.on('ERROR', cleanup)
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('SIGHUP', cleanup)

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    console.error('Uncaught Exception:', error)
    await cleanup()
  })

  process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason)
    await cleanup()
  })
}
