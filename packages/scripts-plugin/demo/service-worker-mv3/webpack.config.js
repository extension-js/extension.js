const {join} = require('path')
const webpack = require('webpack')
const ScriptsPlugin = require('../../dist/module').default
const WebExtension = require('webpack-target-webextension')

/** @type {webpack.Configuration} */
const config = {
  devtool: 'cheap-source-map',
  entry: {},
  output: {
    path: join(__dirname, './dist'),
    // Our assets are emitted in /dist folder of our web extension.
    publicPath: '/dist/'
  },
  plugins: [
    new ScriptsPlugin({
      manifestPath: join(__dirname, './manifest-plugin.json')
    }),
    new WebExtension({
      background: {
        entry: 'background.background',
        manifest: 3
      }
    })
  ],
  devServer: {
    hot: 'only',
    watchFiles: ['src/**/*.css']
  }
}

module.exports = config
