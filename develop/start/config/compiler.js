const path = require('path')
const webpack = require('webpack')
const CopyPlugin = require('copy-webpack-plugin')
const WebpackWebExtensionEntriesPlugin =
  require('../../../packages/webpack-web-extension-entries-plugin')
const resolveBackgroundScripts = require('../resolve/resolveBackgroundScripts')

process.on('unhandledRejection', (error) => { throw error })

module.exports = (projectDir, manifestPath) => {
  const publicPath = path.join(projectDir, 'public')
  const distFolder = path.join(projectDir, 'dist')

  return {
    // https://github.com/webpack/webpack/issues/2145
    devtool: 'inline-cheap-module-source-map',
    entry: {
      background: resolveBackgroundScripts(manifestPath)
    },
    output: {
      path: distFolder
    },
    plugins: [
      new WebpackWebExtensionEntriesPlugin(manifestPath),
      // Polyfill `browser` namespace for unspported browsers (FF and Edge).
      // TODO: Do not add this plugin when developing for those vendors
      new webpack.ProvidePlugin({ browser: require.resolve('webextension-polyfill') }),
      new CopyPlugin({
        patterns: [
          { from: manifestPath, to: path.join(publicPath, 'manifest.json') }
        ]
      })
    ],
    module: {
      // Adapted from
      // https://github.com/webextension-toolbox/webextension-toolbox
      // Relased under MIT license. Copyright 2018 Henrik Wenz
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
}
