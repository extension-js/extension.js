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

export default function webpackConfig(
  projectPath: string,
  {...devOptions}: DevOptions
): webpack.Configuration {
  const manifestPath = path.join(projectPath, 'manifest.json')
  const outputPath = path.join(
    projectPath,
    `dist/${devOptions.browser || 'chrome'}`
  )
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

        if (runtime.startsWith('content_scripts')) {
          const [, contentName] = runtime.split('/')
          const index = contentName.split('-')[1]

          return `web_accessible_resources/resource-${index}/[name].js`
        }

        // Chunks are stored within their caller's directory,
        // So a dynamic import of a CSS action page will be stored
        // as action/[filename].css.
        // The JS counterpart of this is defined in MiniCssExtractPlugin
        // options.chunkFilename function.
        return `${runtime}/[name].js`
      }
    },
    resolve: {
      mainFields: ['browser', 'module', 'main'],
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
          parser: {
            dataUrlCondition: {
              // inline images < 2 KB
              maxSize: 2 * 1024
            }
          }
        },
        {
          test: /\.(woff|woff2|eot|ttf|otf)$/i,
          type: 'asset/resource'
        },
        {
          test: /\.(txt|md|csv|tsv|xml|pdf|docx|doc|xls|xlsx|ppt|pptx|zip|gz|gzip|tgz)$/i,
          type: 'asset/resource',
          parser: {
            dataUrlCondition: {
              // inline images < 2 KB
              maxSize: 2 * 1024
            }
          }
        },
        {
          test: /\.(csv|tsv)$/i,
          use: [require.resolve('csv-loader')]
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
        polyfill: devOptions.polyfill,
        browser: devOptions.browser,
        manifestPath
      }),
      new ExtensionPlugin({
        browser: devOptions.browser,
        manifestPath
      }),
      new ReloadPlugin({
        browser: devOptions.browser,
        manifestPath,
        port: devOptions.port
      }),
      new BrowsersPlugin({
        browser: devOptions.browser,
        // startingUrl: devOptions.startingUrl,
        // profile: devOptions.profile || devOptions.userDataDir,
        // preferences: devOptions.preferences,
        // browserFlags: devOptions.browserFlags,
        extension: [
          outputPath,
          // Extensions output by the ReloadPlugin
          path.join(__dirname, 'extensions', 'manager-extension'),
          path.join(__dirname, 'extensions', 'reload-extension')
        ]
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
    cache: false,
    performance: {
      hints: false,
      maxAssetSize: 999000,
      maxEntrypointSize: 999000
    },
    optimization: {
      minimize: devOptions.mode === 'production'
      // WARN: This can have side-effects.
      // See https://webpack.js.org/guides/code-splitting/#entry-dependencies
      // runtimeChunk: true,
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
