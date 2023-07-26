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
  getWebpackPublicPath
} from './config/getPath'
import jsOptimizationOptions from './options/jsOptimization'
import cssOptimizationOptions from './options/cssOptimization'

// Loaders
import assetLoaders from './loaders/assetLoaders'
import htmlLoaders from './loaders/htmlLoaders'
import jsLoaders from './loaders/jsLoaders'
import styleLoaders from './loaders/styleLoaders'

// Plugins
import compilationPlugins from './plugins/compilation'
import extensionPlugins from './plugins/extension'
import reloadPlugins from './plugins/reload'
import errorPlugins from './plugins/error'
import JsonMinimizerPlugin from 'json-minimizer-webpack-plugin'
import TerserPlugin from 'terser-webpack-plugin'
import CssMinimizerPlugin from 'css-minimizer-webpack-plugin'

// Checks
import {isUsingTypeScript} from './options/typescript'
import getDevToolOption from './config/getDevtoolOption'
import browserPlugins from './plugins/browser'

export default function webpackConfig(
  projectPath: string,
  mode: 'development' | 'production',
  {...devOptions}: DevOptions
): webpack.Configuration {
  return {
    mode,
    // target: 'web',
    context: projectPath,
    devtool: getDevToolOption(projectPath),
    entry: {},
    output: {
      path: getOutputPath(projectPath, devOptions.browser),
      // See https://webpack.js.org/configuration/output/#outputpublicpath
      publicPath: getWebpackPublicPath(projectPath),
      clean: true,
      environment: {
        bigIntLiteral: true,
        dynamicImport: true,
        module: true
      }
    },
    resolve: {
      mainFields: ['browser', 'module', 'main'],
      modules: getModulesToResolve(projectPath),
      extensions: [
        '.js',
        '.mjs',
        '.json',
        '.wasm',
        '.jsx',
        ...(isUsingTypeScript(projectPath) ? ['.ts', '.tsx'] : [])
      ]
    },
    watchOptions: {
      ignored: /node_modules/
    },
    module: {
      rules: [
        ...jsLoaders(projectPath, {mode}),
        ...styleLoaders(projectPath, {mode}),
        ...htmlLoaders,
        ...assetLoaders
      ]
    },
    plugins: [
      compilationPlugins(projectPath, devOptions),
      extensionPlugins(projectPath, devOptions),
      reloadPlugins(projectPath, devOptions),
      browserPlugins(projectPath, devOptions),
      errorPlugins(projectPath, devOptions)
    ],
    optimization: {
      minimize: false,
      // runtimeChunk: {
      //   name: (entrypoint: any) => {
      //     if (entrypoint.name.startsWith("background")) {
      //       return null;
      //     }

      //     return `runtime-${entrypoint.name}`
      //   }
      // },
      // splitChunks: {
      //   chunks(chunk) {
      //     return chunk.name !== "background";
      //   },
      // },
      // TODO: cezaraugusto this can have side-effects.
      // https://webpack.js.org/guides/code-splitting/#entry-dependencies
      // runtimeChunk: 'single',
      minimizer: [
        // Minify JSON
        new JsonMinimizerPlugin(),
        // Minify JavaScript
        new TerserPlugin(jsOptimizationOptions),
        // Minify CSS
        new CssMinimizerPlugin(cssOptimizationOptions)
      ]
    },
    stats: {
      children: true,
      errorDetails: true
    }
  }
}
