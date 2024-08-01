// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import type webpack from 'webpack'
import {type DevOptions} from '../commands/dev'

// Plugins
import {CompilationPlugin} from './plugin-compilation'
import {CssPlugin} from './plugin-css'
import {JsFrameworksPlugin} from './plugin-js-frameworks'
import {ExtensionPlugin} from './plugin-extension'
import {ReloadPlugin} from './plugin-reload'
import {CompatibilityPlugin} from './plugin-compatibility'
import {ErrorsPlugin} from './plugin-errors'
import {BrowsersPlugin} from '../plugin-browsers'

export const getAssetFilename = (folderPath: string) => {
  return `${folderPath}/[name][ext]`
}

export default function webpackConfig(
  projectPath: string,
  {...devOptions}: DevOptions
): webpack.Configuration {
  const manifestPath = path.join(projectPath, 'manifest.json')
  const outputPath = path.join(projectPath, `dist/${devOptions.browser}`)
  const manifest = require(manifestPath)

  return {
    mode: devOptions.mode,
    entry: {},
    target: 'web',
    context: projectPath,
    devtool:
      manifest.manifest_version === 3
        ? 'cheap-source-map'
        : 'eval-cheap-source-map',
    output: {
      clean: {
        keep(asset) {
          // Avoids deleting the hot-update files for the content scripts.
          // This is a workaround for the issue described
          // in https://github.com/cezaraugusto/extension.js/issues/35.
          // These HMR assets are eventually deleted by CleanHotUpdatesPlugin when webpack starts.
          return !asset.startsWith('hot/background')
        }
      },
      path: outputPath,
      // See https://webpack.js.org/configuration/output/#outputpublicpath
      publicPath: '/',
      hotUpdateChunkFilename: 'hot/[id].[fullhash].hot-update.js',
      hotUpdateMainFilename: 'hot/[runtime].[fullhash].hot-update.json',
      environment: {
        bigIntLiteral: true,
        dynamicImport: true
      },
      chunkFilename: (pathData) => {
        const runtime = (pathData.chunk as any)?.runtime

        // Chunks are stored within their caller's directory,
        // So a dynamic import of a CSS action page will be stored
        // as action/[filename].css.
        // The JS counterpart of this is defined in MiniCssExtractPlugin
        // options.chunkFilename function.
        return getAssetFilename(runtime)
      }
    },
    resolve: {
      modules: ['node_modules', path.join(projectPath, 'node_modules')],
      extensions: [
        '.js',
        '.mjs',
        '.jsx',
        '.mjsx',
        '.ts',
        '.mts',
        '.tsx',
        '.mtsx',
        '.json',
        '.wasm'
      ]
    },
    watchOptions: {
      ignored: /node_modules|dist/
    },
    module: {
      rules: [
        {
          test: /\.(png|jpg|jpeg|gif|webp|avif|ico|bmp|svg)$/i,
          type: 'asset/resource',
          generator: {
            filename: () => getAssetFilename('assets')
          },
          parser: {
            dataUrlCondition: {
              // inline images < 2 KB
              maxSize: 2 * 1024
            }
          }
        },
        {
          test: /\.(woff|woff2|eot|ttf|otf)$/i,
          type: 'asset/resource',
          generator: {
            filename: () => getAssetFilename('assets')
          }
        },
        {
          test: /\.(txt|md|csv|tsv|xml|pdf|docx|doc|xls|xlsx|ppt|pptx|zip|gz|gzip|tgz)$/i,
          type: 'asset/resource',
          generator: {
            filename: () => getAssetFilename('assets')
          },
          parser: {
            dataUrlCondition: {
              // inline images < 2 KB
              maxSize: 2 * 1024
            }
          }
        },
        {
          test: /\.(csv|tsv)$/i,
          use: [require.resolve('csv-loader')],
          generator: {
            filename: () => getAssetFilename('assets')
          }
        }
      ]
    },
    plugins: [
      new CompilationPlugin({
        manifestPath
      }),
      new CssPlugin({
        manifestPath,
        mode: devOptions.mode
      }),
      new JsFrameworksPlugin({
        manifestPath,
        mode: devOptions.mode
      }),
      new ErrorsPlugin({
        manifestPath,
        browser: devOptions.browser
      }),
      new CompatibilityPlugin({
        manifestPath,
        browser: devOptions.browser,
        polyfill: devOptions.polyfill
      }),
      new ExtensionPlugin({
        manifestPath,
        browser: devOptions.browser
      }),
      new ReloadPlugin({
        manifestPath,
        browser: devOptions.browser,
        port: devOptions.port
      }),
      new BrowsersPlugin({
        extension: [
          // This is your extension :P
          outputPath,
          // Extensions output by the ReloadPlugin. These are our extensions :P
          path.join(__dirname, 'extensions', 'manager-extension'),
          path.join(__dirname, 'extensions', 'reload-extension')
          // TODO: Add possible extensions required by the user via --load-extension
        ],
        browser: devOptions.browser,
        startingUrl: devOptions.startingUrl,
        profile: devOptions.profile || devOptions.userDataDir,
        preferences: devOptions.preferences,
        // Prevent users from passing a flag to
        // add extensions to the browser as it (should be) handled by the "extension" option.
        browserFlags: devOptions.browserFlags?.filter(
          (flag) => !flag.startsWith('--load-extension=')
        )
      })
    ],
    stats: {
      children: true,
      errorDetails: true,
      entrypoints: false,
      colors: true,
      assets: false,
      chunks: false,
      modules: false
    },
    infrastructureLogging: {
      level: 'none'
    },
    performance: {
      hints: false,
      maxAssetSize: 999000,
      maxEntrypointSize: 999000
    },
    optimization: {
      minimize: devOptions.mode === 'production'
    },
    experiments: {
      // Enable native CSS support. Note that it's an experimental feature still under development
      // and will be enabled by default in webpack v6, however you can track the progress on GitHub
      // here: https://github.com/webpack/webpack/issues/14893.
      css: devOptions.mode === 'production',
      // Support the new WebAssembly according to the updated specification,
      // it makes a WebAssembly module an async module.
      asyncWebAssembly: true
      // Once enabled, webpack will output ECMAScript module syntax whenever possible.
      // For instance, import() to load chunks, ESM exports to expose chunk data, among others.
      // TODO: cezaraugusto as we mature the ManifestPlugin to handle files without hardcoded names,
      // we can enable this feature as long as we have tests to cover it.
      // outputModule: false
    }
  }
}
