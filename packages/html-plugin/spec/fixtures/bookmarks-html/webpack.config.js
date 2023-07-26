const path = require('path')
const HtmlPlugin = require('../../../dist/module').default

const manifestPath = path.join(__dirname, 'manifest.json')
const output = path.resolve(__dirname, './dist')

module.exports = {
  mode: 'development',
  entry: {},
  output: {
    path: output,
    clean: true
  },

  plugins: [
    new HtmlPlugin({
      manifestPath,
      output: {
        bookmarks: 'bookmarks'
      }
    })
  ]
}
