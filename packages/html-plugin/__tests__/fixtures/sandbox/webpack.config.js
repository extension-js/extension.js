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
        path.join(__dirname, 'pages', 'custom.html')
      ],
      exclude: [
        path.join(__dirname, 'public', 'css', 'file.css'),
        path.join(__dirname, 'public', 'js', 'file.js'),
        path.join(__dirname, 'public', 'img', 'icon.png'),
        path.join(__dirname, 'public', 'html', 'file.html')
      ]
    })
  ]
}
