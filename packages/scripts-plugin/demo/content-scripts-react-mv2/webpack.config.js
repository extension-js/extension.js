const path = require('path')
const webpack = require('webpack')
const ReactRefreshTypeScript = require('react-refresh-typescript')
const ReactRefreshPlugin = require('@pmmmwh/react-refresh-webpack-plugin')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const ScriptsPlugin = require('../../dist/module').default
const WebExtension = require('webpack-target-webextension')

/** @returns {webpack.Configuration} */
const config = (a, env) => ({
  devtool: env.mode === 'production' ? undefined : 'eval-cheap-source-map',
  resolve: {
    extensions: ['.ts', '.tsx', '.js']
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader']
      },
      {
        test: /\.tsx?$/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            getCustomTransformers: () => ({
              before: [
                env.mode === 'development' && ReactRefreshTypeScript()
              ].filter(Boolean)
            })
          }
        }
      }
    ]
  },
  entry: {
    reloader: path.join(__dirname, './src/reloader.ts')
  },
  output: {
    path: path.join(__dirname, './dist'),
    // Our assets are emitted in /dist folder of our web extension.
    publicPath: '/dist/',
    environment: {
      dynamicImport: true
    }
  },
  plugins: [
    new ScriptsPlugin({
      manifestPath: path.join(__dirname, './manifest-plugin.json')
    }),
    new MiniCssExtractPlugin(),
    new HtmlWebpackPlugin({filename: 'options.html', chunks: ['options']}),
    new WebExtension({
      background: {pageEntry: 'reloader'},
      weakRuntimeCheck: true
    }),
    env.mode === 'development' && new ReactRefreshPlugin()
  ].filter(Boolean),
  devServer: {
    hot: 'only'
  },
  optimization: {
    minimize: false
  }
})
module.exports = config
