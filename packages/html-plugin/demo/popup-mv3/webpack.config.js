const path = require('path')
const webpack = require('webpack')
const HtmlPlugin = require('../../dist/module').default
const WebExtension = require('webpack-target-webextension')

/** @type {webpack.Configuration} */
const config = {
  // No eval allowed in MV3
  devtool: 'cheap-source-map',
  entry: {
    background: path.join(__dirname, './src/background.js')
  },
  output: {
    path: path.join(__dirname, './dist'),
    publicPath: '/dist/'
  },
  plugins: [
    new HtmlPlugin({
      manifestPath: path.join(__dirname, './manifest-plugin.json')
    }),
    new WebExtension({
      background: {
        entry: 'background',
        manifest: 3
      }
    })
  ],
  devServer: {
    hot: 'only',
    watchFiles: ['src/**/*.html']
  }
}

module.exports = config
