// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import type webpack from 'webpack'
import {type DevOptions} from '../develop-types'

// Option files for plugins
import {
  getOutputPath,
  getModulesToResolve,
  getWebpackPublicPath,
  getExtensionsToResolve,
  getAliasToResolve
} from './config/getPath'

// Loaders
import assetLoaders from './loaders/asset-loaders'
import jsLoaders from './loaders/js-loaders'

// Plugins
import {CompilationPlugin} from './plugin-compilation'
import {CssPlugin} from './plugin-css'
import {ExtensionPlugin} from './plugin-extension'
import {ReloadPlugin} from './plugin-reload'
import compatPlugin from './plugin-compat'
import errorPlugin from './plugin-errors'
import {BrowsersPlugin} from '../plugin-browsers'

// Checks
import getDevToolOption from './config/getDevtoolOption'
import {getWebpackStats} from './config/logging'

export default function webpackConfig(
  projectPath: string,
  {...devOptions}: DevOptions
): webpack.Configuration {
  const manifestPath = path.join(projectPath, 'manifest.json')
  return {
    mode: devOptions.mode,
    entry: {},
    target: 'web',
    context: projectPath,
    devtool: getDevToolOption(projectPath, devOptions.mode),
    stats: getWebpackStats(),
    infrastructureLogging: {
      level: 'none'
    },
    cache: false,
    performance: {
      hints: false,
      maxAssetSize: 999000,
      maxEntrypointSize: 999000
    },
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
      path: getOutputPath(projectPath, devOptions.browser),
      // See https://webpack.js.org/configuration/output/#outputpublicpath
      publicPath: getWebpackPublicPath(projectPath),
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
      alias: getAliasToResolve(projectPath),
      modules: getModulesToResolve(projectPath),
      extensions: getExtensionsToResolve(projectPath)
    },
    watchOptions: {
      ignored: /node_modules|dist/
    },
    module: {
      rules: [...jsLoaders(projectPath, devOptions), ...assetLoaders]
    },
    plugins: [
      new CompilationPlugin({
        manifestPath
      }),
      new CssPlugin({
        manifestPath,
        mode: devOptions.mode
      }),
      errorPlugin(projectPath, devOptions),
      compatPlugin(projectPath, devOptions),
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
        extension: [
          getOutputPath(projectPath, devOptions.browser),
          // Extensions output by the ReloadPlugin
          path.join(__dirname, 'extensions', 'manager-extension'),
          path.join(__dirname, 'extensions', 'reload-extension')
        ]
        // browserFlags: devOptions.browserFlags
      })
    ].filter(Boolean),
    optimization: {
      minimize: devOptions.mode === 'production'
      // WARN: This can have side-effects.
      // See https://webpack.js.org/guides/code-splitting/#entry-dependencies
      // runtimeChunk: true,
    },
    experiments: {
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
