const path = require('path')
const webpack = require('webpack')
const HtmlPlugin = require('../../dist/module').default
const WebExtension = require('webpack-target-webextension')

/** @type {webpack.Configuration} */
const config = {
  devtool: 'cheap-source-map',
  entry: {
    content: path.join(__dirname, './src/content.js'),
    reloader: path.join(__dirname, './src/reloader.js')
  },
  output: {
    path: path.join(__dirname, './dist'),
    publicPath: '/dist/',
    environment: {
      dynamicImport: true
    }
  },
  plugins: [
    new HtmlPlugin({
      manifestPath: path.join(__dirname, './manifest-plugin.json')
    }),
    new WebExtension({background: {entry: 'reloader'}})
  ],
  devServer: {
    hot: 'only'
  }
}
module.exports = config
