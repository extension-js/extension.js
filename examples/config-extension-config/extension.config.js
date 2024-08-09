/** @type {import('extension-develop').Config} */
module.exports = {
  dev: {
    config: (config) => {

      config.module.rules.push({
          test: /\.svg$/i,
          issuer: /\.[jt]sx?$/,
          // exclude react component if *.svg?url
          resourceQuery: {not: [/url/]},
          use: [require.resolve('@svgr/webpack')]
      })

      return config
    }
  },
  preview: {
    config: (config) => {
      return config
    }
  },
  build: {
    config: (config) => {
      return config
    }
  }
}
