// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as path from 'path'
import * as fs from 'fs'
import {type Configuration} from '@rspack/core'
import {DevOptions} from '../commands/commands-lib/config-types'
import {type ProjectStructure} from '../commands/commands-lib/get-project-path'

// Plugins
import {CompilationPlugin} from './plugin-compilation'
import {CssPlugin} from './plugin-css'
import {StaticAssetsPlugin} from './plugin-static-assets'
import {JsFrameworksPlugin} from './plugin-js-frameworks'
import {ExtensionPlugin} from './plugin-extension'
import {ReloadPlugin} from './plugin-reload'
import {CompatibilityPlugin} from './plugin-compatibility'
import {BrowsersPlugin} from '../plugin-browsers'
import * as utils from './lib/utils'

export default function webpackConfig(
  projectStructure: ProjectStructure,
  devOptions: DevOptions & {
    preferences?: Record<string, string>
    browserFlags?: string[]
  } & {
    output: {
      clean: boolean
      path: string
    }
  }
): Configuration {
  const {manifestPath, packageJsonPath} = projectStructure
  const manifestDir = path.dirname(manifestPath)
  const packageJsonDir = path.dirname(packageJsonPath)

  const manifest = utils.filterKeysForThisBrowser(
    JSON.parse(fs.readFileSync(manifestPath, 'utf-8')),
    devOptions.browser
  )
  const userExtensionOutputPath = devOptions.output.path

  const managerExtensionOutputPath = path.join(
    manifestDir,
    'dist',
    'extension-js',
    'extensions',
    `${devOptions.browser}-manager`
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
    context: packageJsonDir,
    devtool:
      manifest.manifest_version === 3
        ? 'cheap-source-map'
        : 'eval-cheap-source-map',
    output: {
      clean: devOptions.output?.clean,
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
      modules: [
        'node_modules',
        path.join(packageJsonDir, 'node_modules'),
        // Add root node_modules for monorepo support
        path.join(process.cwd(), 'node_modules')
      ],
      extensions: [
        '.js',
        '.mjs',
        '.jsx',
        '.ts',
        '.mts',
        '.tsx',
        '.json',
        '.wasm',
        '.svelte'
      ]
    },
    watchOptions: {
      ignored: /node_modules|dist/
    },
    module: {
      rules: [],
      // This allows you, when using CSS Modules, to import the entire style module
      // by default import, in addition to namespace imports and named imports.
      // See https://rspack.dev/guide/tech/css#css-modules
      parser: {
        'css/auto': {
          namedExports: false
        }
      }
    },
    cache: false,
    plugins: [
      new CompilationPlugin({
        manifestPath,
        browser,
        clean: devOptions.output?.clean
      }),
      new StaticAssetsPlugin({
        mode: devOptions.mode,
        manifestPath
      }),
      new CssPlugin({
        manifestPath
      }),
      new JsFrameworksPlugin({
        mode: devOptions.mode,
        manifestPath
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
        port: devOptions.port || 8080
      }),
      new BrowsersPlugin({
        extension: [
          userExtensionOutputPath,
          devOptions.mode !== 'production' ? managerExtensionOutputPath : ''
        ],
        browser,
        open: devOptions.open,
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
      // Enable native CSS support by default
      css: true,
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
