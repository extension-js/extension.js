const path = require('path')
const webpack = require('webpack')
const { log } = require('log-md')
const WebpackDevServer = require('webpack-dev-server')
const compilerConfig = require('../config/compiler.js')
const serverConfig = require('../config/server.js')
const {openExtensionInBrowser, closeBrowser} = require('./openBrowser.js')

async function closeAll (devServer) {
  await closeBrowser()
  devServer.close()
  process.exit()
}

module.exports = async function (projectDir, manifestPath) {
  const serverOptions = {
    // Tell the server where to serve content from
    contentBase: path.dirname(manifestPath)
  }

  const webpackConfig = compilerConfig(projectDir, manifestPath)

  const compiler = webpack(webpackConfig)
  const server = { ...serverConfig, ...serverOptions }
  const devServer = new WebpackDevServer(compiler, server)

  const PORT = 3001
  const HOST = '127.0.0.1'

  devServer.listen(PORT, HOST, async (error) => {
    log('Starting the development server...')
 
    if (error) return log(`Error in the extension runner: ${error}`)

    log('Opening the browser with your extensionn loaded...')

    await openExtensionInBrowser(projectDir, {
      // Starting URL to open the browser with
      startingUrl: 'about:blank'
    })
  })

  process.on('SIGINT', () => closeAll(devServer))
  process.on('SIGTERM', () => closeAll(devServer))
}
