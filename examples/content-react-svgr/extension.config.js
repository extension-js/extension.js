/** @type {import('extension').FileConfig} */
module.exports = {
  config: (config) => {
    config.module.rules.push(
      {
        test: /\.svg$/i,
        type: 'asset',
        // *.svg?url
        resourceQuery: /url/
      },
      {
        test: /\.svg$/i,
        issuer: /\.[jt]sx?$/,
        // exclude react component if *.svg?url
        resourceQuery: {not: [/url/]},
        use: ['@svgr/webpack']
      }
    )

    return config
  }
}
