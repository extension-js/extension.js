// ███████╗████████╗ █████╗ ██████╗ ████████╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
// ███████╗   ██║   ███████║██████╔╝   ██║
// ╚════██║   ██║   ██╔══██║██╔══██╗   ██║
// ███████║   ██║   ██║  ██║██║  ██║   ██║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

const path = require('path')

const webpack = require('webpack')
const {log} = require('log-md')
const WebpackDevServer = require('webpack-dev-server')

const compilerConfig = require('../config/compiler.js')
const serverConfig = require('../config/server.js')

function closeAll (devServer) {
  devServer.close()
  process.exit()
}

module.exports = function (projectDir, {manifestPath, browserVendor}) {
  const serverOptions = {
    // Tell the server where to serve content from
    contentBase: path.dirname(manifestPath)
  }

  const webpackConfig = compilerConfig(projectDir, {
    manifestPath,
    browserVendor
  })

  const compiler = webpack(webpackConfig)
  const server = {...serverConfig, ...serverOptions}
  const devServer = new WebpackDevServer(compiler, server)

  const PORT = 3001
  const HOST = '127.0.0.1'

  devServer.listen(PORT, HOST, (error) => {
    if (error) return log(`Error in the extension runner: ${error}`)
  })

  process.on('SIGINT', () => closeAll(devServer))
  process.on('SIGTERM', () => closeAll(devServer))
}
