/** @type {import('extension').FileConfig} */
const config = {
  config: (config) => {
    config.module.rules.push(
      // https://webpack.js.org/loaders/babel-loader/
      // https://babeljs.io/docs/en/babel-loader
      {
        test: /\.(js|mjs|jsx|ts|tsx)$/,
        exclude: [/[\\/]node_modules[\\/]/],
        loader: 'babel-loader'
      }
    )

    return config
  }
}

export default config
