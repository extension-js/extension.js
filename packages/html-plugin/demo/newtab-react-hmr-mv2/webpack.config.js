const path = require('path')
const webpack = require('webpack')
const ReactRefreshTypeScript = require('react-refresh-typescript')
const ReactRefreshPlugin = require('@pmmmwh/react-refresh-webpack-plugin')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const HtmlPlugin = require('../../dist/module').default
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
    publicPath: '/dist/',
    environment: {
      dynamicImport: true
    }
  },
  plugins: [
    new HtmlPlugin({
      manifestPath: path.join(__dirname, './manifest-plugin.json')
    }),
    new MiniCssExtractPlugin(),
    new WebExtension({
      background: {entry: 'reloader'},
      weakRuntimeCheck: true
    }),
    env.mode === 'development' && new ReactRefreshPlugin()
  ],
  devServer: {
    hot: 'only',
    watchFiles: ['src/**/*.html']
  },
  optimization: {
    minimize: false
  }
})
module.exports = config
