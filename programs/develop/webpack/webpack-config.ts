// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {type Configuration} from '@rspack/core'
import {type ProjectStructure} from './webpack-lib/project'
import {makeSanitizedConsole} from './webpack-lib/branding'
import {filterKeysForThisBrowser} from './webpack-lib/manifest-utils'
import {asAbsolute, getDirs} from './webpack-lib/paths'
import {withDarkMode} from './webpack-lib/dark-mode'
import * as messages from './webpack-lib/messages'
import {computeExtensionsToLoad} from './webpack-lib/extensions-to-load'
import {resolveTranspilePackageDirs} from './webpack-lib/transpile-packages'
import {resolveCompanionExtensionDirs} from './feature-special-folders/folder-extensions/companion-extensions'
import {SpecialFoldersPlugin} from './feature-special-folders'

// Plugins
import {CompilationPlugin} from './plugin-compilation'
import {CssPlugin} from './plugin-css'
import {StaticAssetsPlugin} from './plugin-static-assets'
import {JsFrameworksPlugin} from './plugin-js-frameworks'
import {WebExtensionPlugin} from './plugin-web-extension'
import {CompatibilityPlugin} from './plugin-compatibility'
import {BrowsersPlugin} from './plugin-browsers'
import {WasmPlugin} from './plugin-wasm'

// Types
import type {WebpackConfigOptions} from './webpack-types'

export default function webpackConfig(
  projectStructure: ProjectStructure,
  devOptions: WebpackConfigOptions
): Configuration {
  const {manifestPath} = projectStructure
  const {packageJsonDir} = getDirs(projectStructure)

  const manifest = filterKeysForThisBrowser(
    JSON.parse(fs.readFileSync(manifestPath, 'utf-8')),
    devOptions.browser
  )
  // Absolute directory where the user's extension build will be written.
  const primaryExtensionOutputDir = asAbsolute(
    path.isAbsolute(devOptions.output.path)
      ? devOptions.output.path
      : path.resolve(packageJsonDir, devOptions.output.path)
  )

  // Additional unpacked extension directories to load alongside the user's extension.
  const companionUnpackedExtensionDirs = resolveCompanionExtensionDirs({
    projectRoot: packageJsonDir,
    config: devOptions.extensions
  })

  const unpackedExtensionDirsToLoad = computeExtensionsToLoad(
    // IMPORTANT: __dirname changes after publishing (compiled output lives in dist/).
    // Always anchor relative paths at the @programs/develop package root to keep
    // companion extensions (devtools/theme) stable across monorepo + published builds.
    path.resolve(__dirname, '..'),
    devOptions.mode,
    devOptions.browser,
    primaryExtensionOutputDir,
    companionUnpackedExtensionDirs,
    manifestPath
  )
  const debug = process.env.EXTENSION_AUTHOR_MODE === 'true'
  const transpilePackageDirs = resolveTranspilePackageDirs(
    packageJsonDir,
    devOptions.transpilePackages
  )

  if (debug) {
    console.log(
      messages.debugBrowser(
        devOptions.browser,
        devOptions.chromiumBinary,
        devOptions.geckoBinary
      )
    )
    console.log(messages.debugContextPath(packageJsonDir))
    console.log(messages.debugOutputPath(primaryExtensionOutputDir))
    console.log(messages.debugExtensionsToLoad(unpackedExtensionDirsToLoad))
    if (
      typeof devOptions.extensions !== 'undefined' &&
      companionUnpackedExtensionDirs.length === 0
    ) {
      console.warn(messages.noCompanionExtensionsResolved())
    }
  }

  // Apply cross-browser dark mode defaults without overriding explicit user choices
  const darkDefaults = withDarkMode({
    browser: devOptions.browser,
    browserFlags: devOptions.browserFlags,
    preferences: devOptions.preferences
  })

  const plugins: NonNullable<Configuration['plugins']> = [
    new CompilationPlugin({
      manifestPath,
      browser: devOptions.browser,
      clean: devOptions.output.clean,
      zip: devOptions.zip === true,
      zipSource: devOptions.zipSource === true,
      zipFilename: devOptions.zipFilename
    }),
    new StaticAssetsPlugin({
      manifestPath,
      mode: devOptions.mode
    }),
    new CssPlugin({
      manifestPath
    }),
    new WasmPlugin({
      manifestPath,
      mode: devOptions.mode
    }),
    new JsFrameworksPlugin({
      manifestPath,
      mode: devOptions.mode,
      transpilePackages: devOptions.transpilePackages
    }),
    new CompatibilityPlugin({
      manifestPath,
      browser: devOptions.browser,
      polyfill: devOptions.polyfill
    }),
    new WebExtensionPlugin({
      manifestPath,
      browser: devOptions.browser
    }),
    new SpecialFoldersPlugin({
      manifestPath
    })
  ]

  if (!devOptions.noRunner) {
    plugins.push(
      new BrowsersPlugin({
        extension: unpackedExtensionDirsToLoad,
        browser: devOptions.browser,
        noOpen: devOptions.noOpen,
        startingUrl: devOptions.startingUrl,
        profile: devOptions.profile,
        persistProfile: (devOptions as any).persistProfile,
        preferences: darkDefaults.preferences,
        browserFlags: darkDefaults.browserFlags,
        chromiumBinary: devOptions.chromiumBinary,
        geckoBinary: devOptions.geckoBinary,
        instanceId: devOptions.instanceId,
        port: devOptions.port,
        source: devOptions.source,
        watchSource: devOptions.watchSource,
        sourceFormat: devOptions.sourceFormat,
        sourceSummary: devOptions.sourceSummary,
        sourceMaxBytes: devOptions.sourceMaxBytes,
        sourceRedact: devOptions.sourceRedact,
        sourceIncludeShadow: devOptions.sourceIncludeShadow,
        sourceDiff: devOptions.sourceDiff,
        // Prevent actual browser launch during monorepo watch
        dryRun: process.env.EXTENSION_DEV_NO_BROWSER === '1',
        // Forward unified logger options to BrowsersPlugin (CDP logger)
        logLevel: devOptions.logLevel,
        logContexts: devOptions.logContexts,
        logFormat: devOptions.logFormat,
        logTimestamps: devOptions.logTimestamps,
        logColor: devOptions.logColor,
        logUrl: devOptions.logUrl,
        logTab: devOptions.logTab
      })
    )
  }

  return {
    mode: devOptions.mode || 'development',
    entry: {},
    target: 'web',
    context: packageJsonDir,
    cache: false,
    devtool:
      (devOptions.mode || 'development') === 'production'
        ? false
        : manifest.manifest_version === 3
          ? 'cheap-source-map'
          : 'eval-cheap-source-map',
    output: {
      clean: devOptions.output.clean,
      path: primaryExtensionOutputDir,
      // See https://webpack.js.org/configuration/output/#outputpublicpath
      publicPath: '/',
      hotUpdateChunkFilename: 'hot/[id].[fullhash].hot-update.js',
      hotUpdateMainFilename: 'hot/[runtime].[fullhash].hot-update.json',
      environment: {
        bigIntLiteral: true,
        dynamicImport: true
      }
    },
    watchOptions: {
      // When transpiling workspace packages from node_modules symlinks, avoid
      // blanket node_modules ignore so edits from those packages can trigger HMR.
      ignored:
        transpilePackageDirs.length > 0
          ? /dist|extension-js\/profiles/
          : /node_modules|dist|extension-js\/profiles/,
      poll: 1000,
      aggregateTimeout: 200
    },
    resolve: {
      // Prefer browser fields and conditions; avoid Node-targeted builds
      mainFields: ['browser', 'module', 'main'],
      conditionNames: ['browser', 'import', 'module', 'default'],
      aliasFields: ['browser'],
      fallback: {
        crypto: false,
        fs: false,
        path: false
      },
      modules: projectStructure.packageJsonPath
        ? [
            'node_modules',
            path.join(packageJsonDir, 'node_modules'),
            // Add root node_modules for monorepo support
            path.join(process.cwd(), 'node_modules')
          ]
        : [
            // Web-only mode: keep resolution simple; rely on local sources
            'node_modules',
            path.join(process.cwd(), 'node_modules')
          ],
      extensions: [
        '.js',
        '.cjs',
        '.mjs',
        '.jsx',
        '.ts',
        '.mts',
        '.tsx',
        '.json',
        '.svelte'
      ]
    },
    node: {
      __dirname: false
    },
    resolveLoader: {
      extensions: [
        '.js',
        '.cjs',
        '.mjs',
        '.jsx',
        '.ts',
        '.mts',
        '.tsx',
        '.json'
      ]
    },
    module: {
      // This allows you, when using CSS Modules, to import the entire style module
      // by default import, in addition to namespace imports and named imports.
      // See https://rspack.dev/guide/tech/css#css-modules
      parser: {
        'css/auto': {
          namedExports: false
        }
      }
    },
    plugins,
    // Be quiet about build internals; keep output user-focused.
    // We intentionally do not expose underlying bundler names.
    stats: {
      all: false,
      errors: true,
      warnings: true,
      colors: true,
      errorDetails: false,
      moduleTrace: false,
      logging: 'none'
    },
    infrastructureLogging: {
      // Keep third-party/bundler/dev-server logs hidden by default
      // Only surface when explicitly requested for debugging
      level:
        String(devOptions.mode) === 'development' &&
        String(process.env.EXTENSION_VERBOSE || '').trim() === '1'
          ? 'info'
          : 'error',
      // Sanitize any bundler/dev-server infra logs to use Extension.js branding
      console: makeSanitizedConsole('Extension.js') as any
    },
    performance: {
      // Align with defaults: warn in production only
      hints: devOptions.mode === 'production' ? 'warning' : false
    },
    optimization: {
      // Minify only in production to reduce bundle size
      minimize: devOptions.mode === 'production',
      // Honor package.json sideEffects for better tree-shaking
      sideEffects: true,
      // Mark used exports globally to help dead-code elimination
      usedExports: 'global',
      // Merge small modules for smaller, faster bundles
      concatenateModules: true,
      // Keep a single file per entry (extensions expect static file names)
      splitChunks: false,
      // Do not extract runtime into a separate chunk (keep runtime inline)
      runtimeChunk: false,
      // Stable ids for reproducible builds and better caching
      moduleIds: 'deterministic',
      chunkIds: 'deterministic'
    },
    experiments: {
      // Enable native CSS support by default
      css: true
      // Once enabled, webpack will output ECMAScript module syntax whenever possible.
      // For instance, import() to load chunks, ESM exports to expose chunk data, among others.
      // TODO: cezaraugusto as we mature the ManifestPlugin to handle files without hardcoded names,
      // we can enable this feature as long as we have tests to cover it.
      // outputModule: false
    }
  }
}
