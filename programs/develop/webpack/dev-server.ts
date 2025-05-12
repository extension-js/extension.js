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

  // Get the user defined args and mergee with the Extension.js base webpack config
  const baseConfig = webpackConfig(projectPath, {
    ...devOptions,
    ...commandConfig,
    ...browserConfig,
    mode: 'development',
    output: {
      clean: true
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
      // Allows to set log level in the browser, e.g. before reloading,
      // before an error or when Hot Module Replacement is enabled.
      logging: process.env.EXTENSION_ENV === 'development' ? 'error' : 'none',
      // Prints compilation progress in percentage in the browser.
      progress: false,
      // Shows a full-screen overlay in the browser
      // when there are compiler errors or warnings.
      overlay: false
    },
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    // Use the user provided port or fallback to 'auto'
    port: devOptions.port || 'auto',
    hot: true
  }

  const devServer = new RspackDevServer(serverConfig, compiler as any)

  devServer.startCallback((error) => {
    if (error != null) {
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
