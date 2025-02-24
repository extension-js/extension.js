import WebExtension from 'webpack-target-webextension'
import CopyPlugin from 'copy-webpack-plugin'
import webpack from 'webpack'
import { dirname, join } from 'path'
import ReactRefreshPlugin from '@pmmmwh/react-refresh-webpack-plugin'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @returns {webpack.Configuration} */
const config = (/** @type {any} */ _, /** @type {{ mode: string; }} */ env) => {
  const isProduction = env.mode === 'production'
  return {
    devtool: 'source-map',
    context: __dirname,
    output: {
      path: join(__dirname, './dist'),
      // Our assets are emitted in /dist folder of our web extension.
      publicPath: '/',
      clean: true,
    },
    entry: {
      background: join(__dirname, './src/background/index.ts'),
      content: join(__dirname, './src/content-script/index.tsx'),
      options: join(__dirname, './src/options/index.tsx'),
    },
    module: {
      rules: [
        {
          test: /\.css$/,
          type: 'asset',
        },
        {
          test: /\.(jsx?|tsx?)$/,
          use: [
            {
              loader: 'swc-loader',
              options: {
                jsc: {
                  parser: { syntax: 'typescript', tsx: true },
                  transform: {
                    react: { runtime: 'automatic', development: !isProduction, refresh: !isProduction },
                  },
                },
                env: { targets: ['chrome >= 100'] },
              },
            },
          ],
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({ filename: 'options.html', chunks: ['options'] }),
      new CopyPlugin({
        patterns: [{ from: 'manifest.json' }],
      }),
      new WebExtension({
        background: { serviceWorkerEntry: 'background' },
        experimental_output: {
          background: 'sw.js',
        },
        weakRuntimeCheck: true, // because of HtmlWebpackPlugin
      }),
      isProduction ? null : new ReactRefreshPlugin(),
    ].filter(Boolean),
    optimization: {
      minimizer: [false],
      // runtimeChunk: {
      //   name: (entrypoint) => `runtime-${entrypoint.name}`,
      // },
      splitChunks: {
        chunks: 'all',
        // minSize: 1,
      },
    },
    experiments: { css: true },
  }
}
export default config
