// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import webpack from 'webpack'
import WebpackDevServer from 'webpack-dev-server'
import type {DevOptions} from '../extensionDev'

import devServerConfig from './webpack-dev-server'
import webpackConfig from './webpack-config'

function closeAll(devServer: WebpackDevServer) {
  // devServer.stop()
  devServer.close()
  process.exit()
}

export default async function startDevServer(
  projectPath: string,
  {...devOptions}: DevOptions
) {
  const compilerConfig = webpackConfig(projectPath, 'development', devOptions)
  const serverConfig = await devServerConfig(projectPath, devOptions)
  const compiler = webpack(compilerConfig)

  const devServer = new WebpackDevServer(serverConfig, compiler)

  devServer.startCallback((error) => {
    if (error != null) {
      console.log(`Error in the extension-create runner: ${error.stack || ''}`)
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
