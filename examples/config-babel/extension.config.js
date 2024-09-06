/** @type {import('extension-develop').FileConfig} */
module.exports = {
  config: (config) => {
    config.module.rules.push(
      // https://webpack.js.org/loaders/babel-loader/
      // https://babeljs.io/docs/en/babel-loader
      {
        test: /\.(js|mjs|jsx|ts|tsx)$/,
        include: __dirname,
        exclude: /node_modules/,
        loader: require.resolve('babel-loader')
      }
    )

    return config
  }
}
