import NodePolyfillPlugin from 'node-polyfill-webpack-plugin'

/** @type {import('extension').FileConfig} */
const config = {
  config: (config) => {
    // config.plugins = [...config.plugins, new NodePolyfillPlugin()]

    return config
  }
}

export default config
