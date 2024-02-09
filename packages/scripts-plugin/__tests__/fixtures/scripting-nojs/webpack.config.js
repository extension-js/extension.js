const path = require('path')
const webpack = require('webpack')
const ScriptsPlugin = require('../../../dist/module').default
const MiniCssExtractPlugin = require('mini-css-extract-plugin')

/** @type {webpack.Configuration} */
const config = {
  devtool: 'cheap-source-map',
  mode: 'development',
  entry: {},
  output: {
    path: path.resolve(__dirname, 'dist')
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader']
      }
    ]
  },
  context: path.resolve(__dirname),
  plugins: [
    new MiniCssExtractPlugin(),
    new ScriptsPlugin({
      manifestPath: path.join(__dirname, './manifest.json'),
    })
  ]
}

module.exports = config

