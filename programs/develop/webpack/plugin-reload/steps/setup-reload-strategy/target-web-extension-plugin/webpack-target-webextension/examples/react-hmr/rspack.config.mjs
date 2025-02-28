import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rspack/cli'
import { rspack } from '@rspack/core'
import RefreshPlugin from '@rspack/plugin-react-refresh'
import WebExtension from 'webpack-target-webextension'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default (/** @type {any} */ _, /** @type {{ mode: string; }} */ env) => {
  const isProduction = env.mode === 'production'
  return defineConfig({
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
              loader: 'builtin:swc-loader',
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
      new rspack.HtmlRspackPlugin({ filename: 'options.html', chunks: ['options'] }),
      new rspack.CopyRspackPlugin({
        patterns: [{ from: 'manifest.json' }],
      }),
      new WebExtension({
        background: { serviceWorkerEntry: 'background' },
        experimental_output: {
          background: 'sw.js',
        },
      }),
      isProduction ? null : new RefreshPlugin(),
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
  })
}
