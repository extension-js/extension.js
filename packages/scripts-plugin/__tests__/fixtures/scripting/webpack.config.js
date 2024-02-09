const path = require('path')
const webpack = require('webpack')
const ScriptsPlugin = require('../../../dist/module').default

/** @type {webpack.Configuration} */
const config = {
  devtool: 'cheap-source-map',
  mode: 'development',
  entry: {},
  output: {
    path: path.resolve(__dirname, 'dist')
  },
  plugins: [
    new ScriptsPlugin({
      manifestPath: path.join(__dirname, './manifest.json'),
      include: [path.join(__dirname, 'scripts', 'content-script.js')],
      exclude: [
        path.join(__dirname, 'public', 'css', 'file.css'),
        path.join(__dirname, 'public', 'js', 'file.js'),
        path.join(__dirname, 'public', 'img', 'icon.png'),
        path.join(__dirname, 'public', 'html', 'file.html')
      ]
    })
  ]
}

module.exports = config
