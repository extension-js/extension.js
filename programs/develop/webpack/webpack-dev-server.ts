// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import type WebpackDevServer from 'webpack-dev-server'
import type {DevOptions} from '../extensionDev'
import getNextAvailablePort from './config/getNextAvailablePort'
// import {type getOutputPath} from './config/getPath'

export default async function devServerConfig(
  projectPath: string,
  {port, browser}: DevOptions
): Promise<WebpackDevServer.Configuration> {
  return {
    host: '127.0.0.1',
    allowedHosts: 'all', // TODO: cezaraugusto check
    // static: {
    //     directory: projectPath, // getOutputPath(projectPath, browser),
    //   watch: {
    //     // TODO: revert
    //     ignored: [/\bnode_modules\b/, 
    //     // exclude all js files
    //     /\.js$/,
    //   //  /^((?!content).)*$/,
        
    //   ]
    //   }
    // },
    client: {
      // Allows to set log level in the browser, e.g. before reloading,
      // before an error or when Hot Module Replacement is enabled.
      logging: 'error',
      // Prints compilation progress in percentage in the browser.
      progress: true,
      // Shows a full-screen overlay in the browser
      // when there are compiler errors or warnings.
      overlay: {
        errors: true,
        warnings: true
      }
    },
    devMiddleware: {
      writeToDisk: true
    },
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    port: await getNextAvailablePort(port),
    // Enable webpack's Hot Module Replacement feature
    hot: 'only'
  }
}
