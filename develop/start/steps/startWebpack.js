const path = require('path')
const webpack = require('webpack')
const { log } = require('log-md')
const WebpackDevServer = require('webpack-dev-server')
const compilerConfig = require('../config/compiler.js')
const serverConfig = require('../config/server.js')

function closeServer (devServer) {
  devServer.close()
  process.exit()
}

module.exports = function (projectDir, resolvedManifest) {
  const env = {
    ...process.env,
    projectDir,
    manifestPath: resolvedManifest
  }
  const serverOptions = {
    // Tell the server where to serve content from
    contentBase: path.dirname(resolvedManifest)
  }

  const compiler = webpack(compilerConfig(env))
  const server = { ...serverConfig, ...serverOptions }
  const devServer = new WebpackDevServer(compiler, server)

  const PORT = 3001
  const HOST = '127.0.0.1'

  devServer.listen(PORT, HOST, (error) => {
    if (error) return console.log(error)

    log('Starting the development server...')
  })

  process.on('SIGINT', () => closeServer(devServer))
  process.on('SIGTERM', () => closeServer(devServer))
}
