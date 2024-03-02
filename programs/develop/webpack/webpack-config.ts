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
import JsonMinimizerPlugin from 'json-minimizer-webpack-plugin'
import TerserPlugin from 'terser-webpack-plugin'

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
      hotUpdateChunkFilename: 'hot/[id].[runtime].hot-update.js',
      hotUpdateMainFilename: 'hot/[runtime].hot-update.json',
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
      compatPlugins(projectPath, devOptions),
      browserPlugins(projectPath, devOptions),
      errorPlugins(projectPath, devOptions),
      boringPlugins(projectPath, devOptions)
    ],
    optimization: {
      minimize: mode === 'production'
      // WARN: This can have side-effects.
      // See https://webpack.js.org/guides/code-splitting/#entry-dependencies
      // runtimeChunk: true,
    }
  }
}
