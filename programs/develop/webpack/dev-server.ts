// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import webpack from 'webpack'
import WebpackDevServer from 'webpack-dev-server'
import webpackConfig from './webpack-config'
import type {DevOptions} from '../commands/dev'
import {isUsingJSFramework} from './lib/utils'

function closeAll(devServer: WebpackDevServer) {
  devServer
    .stop()
    .then(() => {
      process.exit()
    })
    .catch((error) => {
      console.log(`Error in the Extension.js runner: ${error.stack || ''}`)
    })
}

export async function devServer(
  projectPath: string,
  {...devOptions}: DevOptions
) {
  const compilerConfig = webpackConfig(projectPath, devOptions)
  const compiler = webpack(compilerConfig)

  const serverConfig: WebpackDevServer.Configuration = {
    host: '127.0.0.1',
    allowedHosts: 'all',
    static: path.join(projectPath, 'public'),
    compress: true,
    devMiddleware: {
      writeToDisk: true
    },
    watchFiles: isUsingJSFramework(projectPath)
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
      overlay: {
        errors: false,
        warnings: false
      }
    },
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    port: 'auto',
    // WARN: Setting TRUE here causes the content_script
    // entry of a react extension to be reloaded infinitely.
    hot: 'only'
  }

  const devServer = new WebpackDevServer(serverConfig, compiler)

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
