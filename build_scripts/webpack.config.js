const path = require('path')
const CopyPlugin = require('copy-webpack-plugin')

module.exports = {
  // https://github.com/webpack/webpack/issues/2145
  devtool: 'inline-cheap-module-source-map',
  devServer: {
    writeToDisk: true,
    disableHostCheck: true,
    port: 8081
  },
  entry: {
    background: ['./src/background.script.js']
  },
  output: {
    path: path.resolve(__dirname, '..', 'package')
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'public/manifest.json', to: 'manifest.json' }
      ]
    })
  ]
}
