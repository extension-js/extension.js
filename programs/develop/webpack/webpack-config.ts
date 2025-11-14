// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as path from 'path'
import * as fs from 'fs'
import {type Configuration} from '@rspack/core'
import {type ProjectStructure} from './webpack-lib/project'
import {makeSanitizedConsole} from './webpack-lib/branding'
import {filterKeysForThisBrowser} from './webpack-lib/manifest-utils'

// Plugins
import {CompilationPlugin} from './plugin-compilation'
import {CssPlugin} from './plugin-css'
import {StaticAssetsPlugin} from './plugin-static-assets'
import {JsFrameworksPlugin} from './plugin-js-frameworks'
import {ExtensionPlugin} from './plugin-extension'
import {CompatibilityPlugin} from './plugin-compatibility'
import {BrowsersPlugin} from './plugin-browsers'
import * as browserMessages from './plugin-browsers/browsers-lib/messages'

// Types
import type {DevOptions} from './webpack-types'

export default function webpackConfig(
  projectStructure: ProjectStructure,
  devOptions: DevOptions & {
    preferences?: Record<string, unknown>
    browserFlags?: string[]
  } & {
    output: {
      clean: boolean
      path: string
    }
  } & {
    // Internal auto-generated instance ID, not user-configurable
    instanceId?: string
  }
): Configuration {
  const {manifestPath, packageJsonPath} = projectStructure
  const manifestDir = path.dirname(manifestPath)
  const packageJsonDir = packageJsonPath
    ? path.dirname(packageJsonPath)
    : manifestDir

  // Accept alias flags: --gecko-binary/--firefox-binary
  const geckoBinaryAlias =
    (devOptions as any).geckoBinary || (devOptions as any).firefoxBinary
  const browser = devOptions.chromiumBinary
    ? 'chromium-based'
    : geckoBinaryAlias
      ? 'gecko-based'
      : devOptions.browser

  const manifest = filterKeysForThisBrowser(
    JSON.parse(fs.readFileSync(manifestPath, 'utf-8')),
    browser
  )
  const userExtensionOutputPath = path.isAbsolute(devOptions.output.path)
    ? devOptions.output.path
    : path.resolve(packageJsonDir, devOptions.output.path)

  // Build list of extensions to load in the browser.
  // Load devtools first (fallback NTP); push the user extension LAST so
  // user overrides (like New Tab) take precedence.
  const extensionsToLoad: string[] = []

  if (devOptions.mode !== 'production') {
    // Look for devtools dist mirrored by programs/develop build pipeline
    const devtoolsRoot = path.resolve(
      __dirname,
      '../dist/extension-js-devtools'
    )
    // Map requested browser to the corresponding devtools manager distribution
    // - chrome -> chrome manager
    // - edge -> edge manager
    // - chromium/chromium-based -> chromium manager
    // - firefox/gecko-based/firefox-based -> firefox manager
    const devtoolsEngine = (() => {
      const b = String(browser || '')
      switch (b) {
        case 'chrome':
          return 'chrome'
        case 'edge':
          return 'edge'
        case 'chromium':
        case 'chromium-based':
          return 'chromium'
        case 'firefox':
        case 'gecko-based':
        case 'firefox-based':
          return 'firefox'
        default:
          return b
      }
    })()

    const devtoolsForBrowser = path.join(devtoolsRoot, devtoolsEngine)

    if (fs.existsSync(devtoolsForBrowser)) {
      extensionsToLoad.push(devtoolsForBrowser)
    }
  }

  // Always load the user extension last to give it precedence on conflicts
  extensionsToLoad.push(userExtensionOutputPath)

  return {
    mode: devOptions.mode || 'development',
    entry: {},
    target: 'web',
    context: packageJsonDir,
    devtool:
      (devOptions.mode || 'development') === 'production'
        ? false
        : manifest.manifest_version === 3
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
      modules: packageJsonPath
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
        '.mjs',
        '.jsx',
        '.ts',
        '.mts',
        '.tsx',
        '.json',
        '.wasm',
        '.svelte'
      ],
      // Prefer browser fields and conditions; avoid Node-targeted builds
      mainFields: ['browser', 'module', 'main'],
      conditionNames: ['browser', 'import', 'module', 'default'],
      aliasFields: ['browser']
    },
    watchOptions: {
      ignored: /node_modules|dist|extension-js\/profiles/,
      poll: 1000,
      aggregateTimeout: 200
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
        clean: devOptions.output?.clean,
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
      new JsFrameworksPlugin({
        manifestPath,
        mode: devOptions.mode
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
      new BrowsersPlugin({
        extension: extensionsToLoad,
        browser,
        noOpen: devOptions.noOpen,
        startingUrl: devOptions.startingUrl,
        profile: devOptions.profile,
        persistProfile: (devOptions as any).persistProfile,
        preferences: devOptions.preferences,
        browserFlags: devOptions.browserFlags,
        chromiumBinary: devOptions.chromiumBinary,
        geckoBinary: geckoBinaryAlias,
        instanceId: devOptions.instanceId,
        port: devOptions.port,
        source: devOptions.source,
        watchSource: devOptions.watchSource,
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
    ],
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
        devOptions.mode === 'development' &&
        String(process.env.EXTENSION_VERBOSE || '').trim() === '1'
          ? 'info'
          : 'error',
      // Sanitize any bundler/dev-server infra logs to use Extension.js branding
      console: makeSanitizedConsole('Extension.js') as any
    },
    ignoreWarnings: [
      (warning: any) => {
        try {
          const message = String(
            (warning && (warning.message || warning)) || ''
          )
          const modulePath =
            (warning &&
              warning.module &&
              (warning.module.resource || warning.module.userRequest)) ||
            ''
          return (
            message.includes('Accessing import.meta directly is unsupported') &&
            /[\\\/]@huggingface[\\\/]transformers[\\\/].*transformers\.web\.js$/.test(
              modulePath
            )
          )
        } catch {
          return false
        }
      }
    ],
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
