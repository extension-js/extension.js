const path = require('path')
const webpack = require('webpack')
const CopyPlugin = require('copy-webpack-plugin')

module.exports = {
  // https://github.com/webpack/webpack/issues/2145
  devtool: 'inline-cheap-module-source-map',
  devServer: {
    writeToDisk: true,
    disableHostCheck: true,
    port: 8081
  },
  entry: {
    background: [
      path.resolve(__dirname, '../src/background.script.js')
    ]
  },
  output: {
    path: path.resolve(__dirname, '../package')
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: path.resolve(__dirname, '../public/manifest.json'), to: 'manifest.json' }
      ]
    }),
    // This is needed only for non-compilant WebExtension APIs
    // (all browsers but Firefox and Edge)
    // TODO: Do not add this plugin when developing for those vendors
    new webpack.ProvidePlugin({ browser: require.resolve('webextension-polyfill') })
  ],
  module: {
    // Adapted from https://github.com/webextension-toolbox/webextension-toolbox,
    // relased under MIT license. Copyright 2018 Henrik Wenz
    rules: [{
      test: /webextension-polyfill[\\/]+dist[\\/]+browser-polyfill\.js$/,
      loader: require.resolve('string-replace-loader'),
      options: {
        search: 'typeof browser === "undefined"',
        replace: 'typeof window.browser === "undefined" || Object.getPrototypeOf(window.browser) !== Object.prototype'
      }
    }]
  }
}
