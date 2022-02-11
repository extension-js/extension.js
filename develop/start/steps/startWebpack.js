// ███████╗████████╗ █████╗ ██████╗ ████████╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
// ███████╗   ██║   ███████║██████╔╝   ██║
// ╚════██║   ██║   ██╔══██║██╔══██╗   ██║
// ███████║   ██║   ██║  ██║██║  ██║   ██║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

const webpack = require('webpack')
const {log} = require('log-md')
const WebpackDevServer = require('webpack-dev-server')

const compilerConfig = require('../config/compiler')
const serverConfig = require('../config/server')

function closeAll(devServer) {
  devServer.close()
  process.exit()
}

module.exports = function startWebpack(
  projectDir,
  {manifestPath, browserVendor}
) {
  const webpackConfig = compilerConfig(projectDir, {
    manifestPath,
    browserVendor
  })

  const compiler = webpack(webpackConfig)
  const devServer = new WebpackDevServer(serverConfig, compiler)

  devServer.startCallback((error) => {
    if (error) return log(`Error in the extension runner: ${error}`)
  })

  process.on('SIGINT', () => closeAll(devServer))
  process.on('SIGTERM', () => closeAll(devServer))
}
