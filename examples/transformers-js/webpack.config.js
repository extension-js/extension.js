import path from 'path'
import {fileURLToPath} from 'url'

import HtmlWebpackPlugin from 'html-webpack-plugin'
import CopyPlugin from 'copy-webpack-plugin'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('webpack').Configuration} */
const config = {
  mode: 'development',
  devtool: 'inline-source-map',
  entry: {
    background: './src/background.js',
    popup: './src/popup.js',
    content: './src/content.js'
  },
  resolve: {
    alias: {
      '@huggingface/transformers': path.resolve(
        __dirname,
        'node_modules/@huggingface/transformers'
      )
    }
  },
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: '[name].js',

    // Otherwise we get `Uncaught ReferenceError: document is not defined`
    chunkLoading: false
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/popup.html',
      filename: 'popup.html'
    }),
    new CopyPlugin({
      patterns: [
        {
          from: 'public',
          to: '.' // Copies to build folder
        },
        {
          from: 'src/popup.css',
          to: 'popup.css'
        }
      ]
    })
  ]
}

export default config
