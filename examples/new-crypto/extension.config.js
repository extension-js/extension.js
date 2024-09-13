const NodePolyfillPlugin = require('node-polyfill-webpack-plugin')

/** @type {import('extension-develop').FileConfig} */
module.exports = {
  config: (config) => {
    config.plugins = [
      ...config.plugins,
      new NodePolyfillPlugin({
        additionalAliases: ['process']
      })
    ]

    return config
  }
}
