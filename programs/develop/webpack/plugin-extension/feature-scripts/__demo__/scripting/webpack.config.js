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
  experiments: {
    // Enable native CSS support. Note that it's an experimental feature still under development
    // and will be enabled by default in webpack v6, however you can track the progress on GitHub
    // here: https://github.com/webpack/webpack/issues/14893.
    css: true
  },
  plugins: [
    new ScriptsPlugin({
      manifestPath: path.join(__dirname, 'manifest.json'),
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
