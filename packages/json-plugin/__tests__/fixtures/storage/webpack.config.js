const path = require('path')
const webpack = require('webpack')
const Jsonlugin = require('../../../dist/module').default

/** @type {webpack.Configuration} */
const config = {
  devtool: 'cheap-source-map',
  mode: 'development',
  entry: {},
  output: {
    path: path.resolve(__dirname, 'dist')
  },
  plugins: [
    new Jsonlugin({
      manifestPath: path.join(__dirname, './manifest.json'),
      exclude: [path.join(__dirname, 'public', 'schema.json')]
    })
  ]
}

module.exports = config
