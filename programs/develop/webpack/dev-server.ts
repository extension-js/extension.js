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
import * as utils from './lib/utils'
import {
  loadBrowserConfig,
  loadCommandConfig,
  loadCustomWebpackConfig
} from '../commands/commands-lib/get-extension-config'
import * as messages from '../commands/commands-lib/messages'
import {PortManager} from './lib/port-manager'

function closeAll(devServer: RspackDevServer) {
  devServer
    .stop()
    .then(() => {
      process.exit()
    })
    .catch((error) => {
      console.log(`Error in the Extension.js runner: ${error.stack || ''}`)
    })
}

export async function devServer(projectPath: string, devOptions: DevOptions) {
  // Get command defaults from extension.config.js
  const commandConfig = loadCommandConfig(projectPath, 'dev')
  // Get browser defaults from extension.config.js
  const browserConfig = loadBrowserConfig(projectPath, devOptions.browser)

  // Initialize port manager and allocate port
  const portManager = new PortManager(devOptions.browser, 8080)
  const portAllocation = await portManager.allocatePorts(devOptions.port)

  // Get the user defined args and merge with the Extension.js base webpack config
  const baseConfig = webpackConfig(projectPath, {
    ...devOptions,
    ...commandConfig,
    ...browserConfig,
    mode: 'development',
    output: {
      clean: false,
      path: path.join(projectPath, 'dist', devOptions.browser)
    }
  })

  // Get webpack config defaults from extension.config.js
  const customWebpackConfig = await loadCustomWebpackConfig(projectPath)
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
    watchFiles: utils.isUsingJSFramework(projectPath)
      ? undefined
      : {
          paths: [path.join(projectPath, '**/*.html')],
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

  process.on('ERROR', () => {
    closeAll(devServer)
  })
  process.on('SIGINT', () => {
    closeAll(devServer)
  })
  process.on('SIGTERM', () => {
    closeAll(devServer)
  })
}
