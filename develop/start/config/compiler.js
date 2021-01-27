// ███████╗████████╗ █████╗ ██████╗ ████████╗
// ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
// ███████╗   ██║   ███████║██████╔╝   ██║
// ╚════██║   ██║   ██╔══██║██╔══██╗   ██║
// ███████║   ██║   ██║  ██║██║  ██║   ██║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝

const webpack = require('webpack')
const RunChromeExtension = require('webpack-run-chrome-extension')

process.on('unhandledRejection', (error) => { throw error })

module.exports = (projectDir, manifestPath) => {
  const config = {
    mode: 'development',
    // https://github.com/webpack/webpack/issues/2145
    devtool: 'inline-cheap-module-source-map',
    plugins: [
      // Polyfill `browser` namespace for unspported browsers (FF and Edge).
      // TODO: Do not add this plugin when developing for those vendors
      new webpack.ProvidePlugin({browser: require.resolve('webextension-polyfill')}),
      new RunChromeExtension({
        extensionPath: projectDir
      })
    ],
    resolve: {
      extensions: ['js', '.json']
    },
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

  return {
    ...config
  }
}
