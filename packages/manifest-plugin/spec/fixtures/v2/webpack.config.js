const path = require('path')
const ManifestPlugin = require('../../../dist/module').default

const manifestPath = path.join(__dirname, 'manifest.json')
const outputPath = path.join(__dirname, './dist')

module.exports = {
  mode: 'development',
  entry: {},
  output: {
    path: outputPath,
    clean: true
  },
  plugins: [
    new ManifestPlugin({
      manifestPath
    })
  ]
}
