const NodePolyfillPlugin = require('node-polyfill-webpack-plugin')

/** @type {import('extension').FileConfig} */
module.exports = {
  config: (config) => {
    config.plugins = [
      ...config.plugins,
      new NodePolyfillPlugin()
    ]

    return config
  }
}
