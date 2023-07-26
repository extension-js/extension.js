const path = require('path')
const webpack = require('webpack')
const ScriptsPlugin = require('../../dist/module').default
const WebExtension = require('webpack-target-webextension')

/** @type {webpack.Configuration} */
const config = {
  devtool: 'eval-cheap-source-map',
  entry: {},
  output: {
    path: path.join(__dirname, './dist'),
    publicPath: '/dist/',
    environment: {
      dynamicImport: true
    }
  },
  plugins: [
    new ScriptsPlugin({
      manifestPath: path.join(__dirname, './manifest-plugin.json')
    }),
    new WebExtension({
      background: {
        serviceWorkerEntry: 'background.background'
        // manifest: 2
      }
    })
  ],
  devServer: {
    // hot: 'only',
    hot: true,
    watchFiles: ['src/**/*.css']
  }
}

module.exports = config
