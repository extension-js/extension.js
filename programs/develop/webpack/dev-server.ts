// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import {rspack} from '@rspack/core'
import {RspackDevServer, Configuration} from '@rspack/dev-server'
import {merge} from 'webpack-merge'
import webpackConfig from './rspack-config'
import type {DevOptions} from '../commands/dev'
import * as utils from './lib/utils'
import {loadExtensionConfig} from '../commands/commands-lib/get-extension-config'

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

export async function devServer(
  projectPath: string,
  {...devOptions}: DevOptions
) {
  const baseConfig = webpackConfig(projectPath, {
    ...devOptions,
    mode: 'development'
  })
  const userExtensionConfig = loadExtensionConfig(projectPath)
  const userConfig = userExtensionConfig(baseConfig)
  const compilerConfig = merge(userConfig)
  const compiler = rspack(compilerConfig)

  const serverConfig: Configuration = {
    host: '127.0.0.1',
    allowedHosts: 'all',
    static: path.join(projectPath, 'public'),
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
    port: 'auto',
    // WARN: Setting TRUE here causes the content_script
    // entry of a react extension to be reloaded infinitely.
    hot: 'only'
  }

  const devServer = new RspackDevServer(serverConfig, compiler)

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
