// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import type WebpackDevServer from 'webpack-dev-server'
import type {DevOptions} from '../extensionDev'
import {getStaticFolderPath} from './config/getPath'
// import getNextAvailablePort from './config/getNextAvailablePort'

export default function devServerConfig(
  projectPath: string,
  {port}: DevOptions
): WebpackDevServer.Configuration {
  return {
    host: '127.0.0.1',
    allowedHosts: 'all',
    static: getStaticFolderPath(projectPath),
    compress: true,
    devMiddleware: {
      writeToDisk: true
    },
    // WARN: for some reason, adding HTML as a watch file
    // causes content_scripts to do a full reload instead of a hot reload.
    // We work around this in the webpack-run extensions by
    // adding the HTML file as an entry point.
    watchFiles: ['**/*.html'],
    client: {
      // Allows to set log level in the browser, e.g. before reloading,
      // before an error or when Hot Module Replacement is enabled.
      logging: 'error',
      // Prints compilation progress in percentage in the browser.
      progress: true,
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
    // TODO: cezaraugusto scan available ports
    // port: getNextAvailablePort(port),
    port: port || 8818,
    // WARN: Setting TRUE here causes the content_script
    // entry of a react extension to be reloaded infinitely.
    hot: 'only'
  }
}
