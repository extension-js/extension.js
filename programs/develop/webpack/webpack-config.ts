// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import type webpack from 'webpack'
import {type DevOptions} from '../extensionDev'

// Option files for plugins
import {
  getOutputPath,
  getModulesToResolve,
  getWebpackPublicPath,
  getExtensionsToResolve
} from './config/getPath'

// Loaders
import assetLoaders from './loaders/assetLoaders'
import jsLoaders from './loaders/jsLoaders'
import styleLoaders from './loaders/styleLoaders'

// Plugins
import compilationPlugins from './plugins/compilationPlugins'
import extensionPlugins from './plugins/extensionPlugins'
import reloadPlugins from './plugins/reloadPlugins'
import compatPlugins from './plugins/compatPlugins'
import errorPlugins from './plugins/errorPlugins'
import browserPlugins from './plugins/browserPlugins'
import boringPlugins from './plugins/boringPlugins'

// Checks
import getDevToolOption from './config/getDevtoolOption'
import {getWebpackStats} from './config/logging'

export default function webpackConfig(
  projectPath: string,
  mode: 'development' | 'production',
  {...devOptions}: DevOptions
): webpack.Configuration {
  return {
    mode,
    entry: {},
    target: 'web',
    context: projectPath,
    devtool: getDevToolOption(projectPath),
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
      clean: true,
      path: getOutputPath(projectPath, devOptions.browser),
      // See https://webpack.js.org/configuration/output/#outputpublicpath
      publicPath: getWebpackPublicPath(projectPath),
      hotUpdateChunkFilename: 'hot/[id].[fullhash].hot-update.js',
      hotUpdateMainFilename: 'hot/[runtime].[fullhash].hot-update.json',
      environment: {
        bigIntLiteral: true,
        dynamicImport: true
      }
    },
    resolve: {
      mainFields: ['browser', 'module', 'main'],
      modules: getModulesToResolve(projectPath),
      extensions: getExtensionsToResolve(projectPath)
    },
    watchOptions: {
      ignored: /node_modules|dist/
    },
    module: {
      rules: [
        ...jsLoaders(projectPath, devOptions),
        ...styleLoaders(projectPath, devOptions),
        ...assetLoaders
      ]
    },
    plugins: [
      compilationPlugins(projectPath, devOptions),
      extensionPlugins(projectPath, devOptions),
      reloadPlugins(projectPath, devOptions),
      browserPlugins(projectPath, devOptions),
      compatPlugins(projectPath, devOptions),
      errorPlugins(projectPath, devOptions),
      boringPlugins(projectPath, devOptions)
    ],
    optimization: {
      minimize: mode === 'production'
      // WARN: This can have side-effects.
      // See https://webpack.js.org/guides/code-splitting/#entry-dependencies
      // runtimeChunk: true,
    },
    experiments: {
      // Enable native CSS support. Note that it's an experimental feature still under development
      // and will be enabled by default in webpack v6, however you can track the progress on GitHub
      // here: https://github.com/webpack/webpack/issues/14893.
      css: true,
      // Support the new WebAssembly according to the updated specification,
      // it makes a WebAssembly module an async module.
      asyncWebAssembly: true,
      // Once enabled, webpack will output ECMAScript module syntax whenever possible.
      // For instance, import() to load chunks, ESM exports to expose chunk data, among others.
      // TODO: cezaraugusto as we mature the ManifestPlugin to handle files without hardcoded names,
      // we can enable this feature as long as we have tests to cover it.
      outputModule: false
    }
  }
}
