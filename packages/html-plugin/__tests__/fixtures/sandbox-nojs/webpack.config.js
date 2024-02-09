const path = require('path')
const HtmlPlugin = require('../../../dist/module').default
const MiniCssExtractPlugin = require('mini-css-extract-plugin')

module.exports = {
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
    new HtmlPlugin({
      manifestPath: path.join(__dirname, 'manifest.json'),
      include: [
        path.join(__dirname, 'pages', 'main.html'),
      ],
    })
  ]
}
