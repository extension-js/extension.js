/** @type {import('extension-develop').ConfigFile} */
module.exports = {
  config: (config) => {
    config.module.rules.push(
      {
        test: /\.svg$/i,
        type: 'asset',
        resourceQuery: /url/ // *.svg?url
      },
      {
        test: /\.svg$/i,
        issuer: /\.[jt]sx?$/,
        resourceQuery: {not: [/url/]}, // exclude react component if *.svg?url
        use: [require.resolve('@svgr/webpack')]
      }
    )

    return config
  }
}
