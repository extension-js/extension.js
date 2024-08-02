const path = require('path')
const HtmlPlugin = require('../../../../../dist/module').default

module.exports = {
  mode: 'development',
  entry: {},
  output: {
    path: path.resolve(__dirname, 'dist')
  },
  context: path.resolve(__dirname),
  experiments: {
    // Enable native CSS support. Note that it's an experimental feature still under development
    // and will be enabled by default in webpack v6, however you can track the progress on GitHub
    // here: https://github.com/webpack/webpack/issues/14893.
    css: true
  },
  plugins: [
    new HtmlPlugin({
      manifestPath: path.join(__dirname, 'manifest.json'),
      include: [path.join(__dirname, 'pages', 'main.html')]
    })
  ]
}
