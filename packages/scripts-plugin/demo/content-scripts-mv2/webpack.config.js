const path = require('path')
const webpack = require('webpack')
const ScriptsPlugin = require('../../dist/module').default
const WebExtension = require('webpack-target-webextension')

/** @type {webpack.Configuration} */
const config = {
  devtool: 'eval-cheap-source-map',
  entry: {
    reloader: path.join(__dirname, './src/reloader.js')
  },
  output: {
    path: path.join(__dirname, './dist'),
    // Our assets are emitted in /dist folder of our web extension.
    publicPath: '/dist/'
  },
  plugins: [
    new ScriptsPlugin({
      manifestPath: path.join(__dirname, './manifest-plugin.json')
    }),
    new WebExtension({background: {pageEntry: 'reloader'}})
  ],
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['css-loader']
      }
    ]
  },
  devServer: {
    hot: 'only'
  }
}

module.exports = config
