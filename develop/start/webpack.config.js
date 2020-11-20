const fs = require('fs')
const path = require('path')
const webpack = require('webpack')
const CopyPlugin = require('copy-webpack-plugin')
const WebpackWebExtensionManifestPlugin = require('../../packages/webpack-web-extension-entries-plugin')

const manifestFilePath = path.resolve(process.env.MANIFEST_FILE)

// by default dist/ is one level up relative to the manifest file
const outputFolderPath = path
  .resolve(path.dirname(manifestFilePath), '..', process.env.DIST_FOLDER || 'dist/')

// Extensions are required to have a valid manifest path.
// If not, abort and error.
if (!fs.existsSync(manifestFilePath)) {
  console.error(' Can\'t find Manifest file. Exiting.')
  process.exit(1)
}

const paths = {
  // Manifest path is declared by the user
  manifestFile: manifestFilePath,
  // Root folder always refers to the manifest path
  rootFolder: path.dirname(manifestFilePath),
  // By default dist/ always refer to the source's package.json path
  distFolder: outputFolderPath
}

const manifest = require(paths.manifestFile)

const background = [...manifest.background.scripts]
const backgroundEntries = background.map(script => path.join(paths.rootFolder, script))

module.exports = {
  // https://github.com/webpack/webpack/issues/2145
  devtool: 'inline-cheap-module-source-map',
  devServer: {
    writeToDisk: true,
    disableHostCheck: true,
    port: 8081
  },
  entry: {
    background: backgroundEntries
  },
  output: {
    path: paths.distFolder
  },
  plugins: [
    new WebpackWebExtensionManifestPlugin(manifest),
    // Polyfill `browser` namespace for unspported browsers (FF and Edge).
    // TODO: Do not add this plugin when developing for those vendors
    new webpack.ProvidePlugin({ browser: require.resolve('webextension-polyfill') }),
    new CopyPlugin({
      patterns: [
        { from: paths.manifestFile, to: 'manifest.json' }
      ]
    })
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
