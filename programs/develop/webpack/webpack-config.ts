// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import type webpack from 'webpack'
import {DevOptions} from '../commands/commands-lib/config-types'

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
import * as utils from './lib/utils'

export default function webpackConfig(
  projectPath: string,
  devOptions: DevOptions & {
    preferences?: Record<string, string>
    browserFlags?: string[]
  }
): webpack.Configuration {
  console.log({
    devOptions
  })
  const manifestPath = path.join(projectPath, 'manifest.json')
  const manifest = utils.filterKeysForThisBrowser(
    require(manifestPath),
    devOptions.browser
  )
  const userExtensionOutputPath = path.join(
    projectPath,
    `dist/${devOptions.browser}`
  )

  const browser = devOptions.chromiumBinary
    ? 'chromium-based'
    : devOptions.geckoBinary
      ? 'gecko-based'
      : devOptions.browser

  return {
    mode: devOptions.mode || 'development',
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
          // These HMR assets are eventually deleted by CleanDistFolderPlugin when webpack starts.
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
        manifestPath,
        browser
      }),
      new StaticAssetsPlugin({
        manifestPath
      }),
      new CssPlugin({
        manifestPath
      }),
      new JsFrameworksPlugin({
        manifestPath
      }),
      process.env.EXPERIMENTAL_ERRORS_PLUGIN === 'true' &&
        new ErrorsPlugin({
          manifestPath,
          browser
        }),
      new CompatibilityPlugin({
        manifestPath,
        browser,
        polyfill: devOptions.polyfill
      }),
      new ExtensionPlugin({
        manifestPath,
        browser
      }),
      new ReloadPlugin({
        manifestPath,
        browser,
        stats: true,
        port: 8000
      }),
      // Open defaults to true
      devOptions.open !== false &&
        new BrowsersPlugin({
          extension: [
            userExtensionOutputPath,
            path.join(__dirname, 'extensions', `${browser}-manager-extension`)
          ],
          browser,
          startingUrl: devOptions.startingUrl,
          profile: devOptions.profile,
          preferences: devOptions.preferences,
          browserFlags: devOptions.browserFlags,
          chromiumBinary: devOptions.chromiumBinary,
          geckoBinary: devOptions.geckoBinary
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
