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
import {StaticAssetsPlugin} from './plugin-static-assets'
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
  devOptions: DevOptions
): webpack.Configuration {
  const manifestPath = path.join(projectPath, 'manifest.json')
  const userExtensionOutputPath = path.join(
    projectPath,
    `dist/${devOptions.browser}`
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
      path: userExtensionOutputPath,
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
        '.ts',
        '.mts',
        '.tsx',
        '.json',
        '.wasm',
        '.less',
        '.css',
        '.sass',
        '.scss'
      ]
    },
    watchOptions: {
      ignored: /node_modules|dist/
    },
    module: {
      rules: []
    },
    plugins: [
      new CompilationPlugin({
        manifestPath
      }),
      new StaticAssetsPlugin({
        manifestPath,
        mode: devOptions.mode
      }),
      new CssPlugin({
        manifestPath,
        mode: devOptions.mode
      }),
      new JsFrameworksPlugin({
        manifestPath,
        mode: devOptions.mode
      }),
      process.env.EXTENSION_ENV === 'development' &&
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
        browser: devOptions.browser,
        mode: devOptions.mode
      }),
      new ReloadPlugin({
        manifestPath,
        browser: devOptions.browser,
        stats: true,
        port: devOptions.port || 8000
      }),
      new BrowsersPlugin({
        extension: [
          userExtensionOutputPath,
          devOptions.browser === 'firefox'
            ? path.join(__dirname, 'extensions', 'manager-extension-firefox')
            : path.join(__dirname, 'extensions', 'manager-extension')
          // TODO: Add possible extensions required by the user via --load-extension
        ],
        browser: devOptions.browser,
        startingUrl: devOptions.startingUrl,
        profile: devOptions.profile || devOptions.userDataDir,
        preferences: devOptions.preferences,
        // Prevent users from passing a flag to
        // add extensions to the browser – as it (should be) handled by the "extension" option.
        browserFlags: devOptions.browserFlags?.filter(
          (flag) => !flag.startsWith('--load-extension=')
        )
      })
    ].filter(Boolean),
    stats: {
      all: false,
      errors: true,
      warnings: true
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
      // css: devOptions.mode === 'production',
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
