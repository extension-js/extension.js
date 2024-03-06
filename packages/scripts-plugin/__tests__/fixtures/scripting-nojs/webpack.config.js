const path = require('path')
const webpack = require('webpack')
const ScriptsPlugin = require('../../../dist/module').default

/** @type {webpack.Configuration} */
const config = {
  devtool: 'cheap-source-map',
  mode: 'development',
  entry: {},
  output: {
    path: path.resolve(__dirname, 'dist')
  },
  context: path.resolve(__dirname),
  experiments: {
    // Enable native CSS support. Note that it's an experimental feature still under development
    // and will be enabled by default in webpack v6, however you can track the progress on GitHub
    // here: https://github.com/webpack/webpack/issues/14893.
    css: true
  },
  plugins: [
    new ScriptsPlugin({
      manifestPath: path.join(__dirname, './manifest.json')
    })
  ]
}

module.exports = config
