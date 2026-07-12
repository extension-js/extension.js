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
import {type ProjectStructure} from './lib/project'
import {makeSanitizedConsole} from './lib/branding'
import {filterKeysForThisBrowser} from './lib/manifest-utils'
import {stripBom} from './lib/parse-json-safe'
import {asAbsolute, getDirs, toPosixPath} from './lib/paths'
import {resolveDevelopInstallRoot} from './lib/develop-context'
import * as messages from './lib/messages'
import {computeExtensionsToLoad} from './lib/extensions-to-load'
import {resolveTranspilePackageDirs} from './lib/transpile-packages'
import {resolveCompanionExtensionDirs} from './plugin-special-folders/folder-extensions/resolve-dirs'
import {SpecialFoldersPlugin} from './plugin-special-folders'

// Plugins
import {CompilationPlugin} from './plugin-compilation'
import {CssPlugin} from './plugin-css'
import {StaticAssetsPlugin} from './plugin-static-assets'
import {JsFrameworksPlugin} from './plugin-js-frameworks'
import {WebExtensionPlugin} from './plugin-web-extension'
import {CompatibilityPlugin} from './plugin-compatibility'
import {PlaywrightPlugin} from './plugin-playwright'
import {WasmPlugin} from './plugin-wasm'
import {PerfBudgetsPlugin} from './plugin-perf-budgets'

// Types
import type {WebpackConfigOptions} from './types'

export default function webpackConfig(
  projectStructure: ProjectStructure,
  devOptions: WebpackConfigOptions
): Configuration {
  const {manifestPath} = projectStructure
  const {packageJsonDir} = getDirs(projectStructure)

  let rawManifest: unknown
  try {
    rawManifest = JSON.parse(stripBom(fs.readFileSync(manifestPath, 'utf-8')))
  } catch (error) {
    throw new Error(messages.manifestInvalidJson(manifestPath, error))
  }
  const manifest = filterKeysForThisBrowser(
    rawManifest as any,
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

  // CSS `url()` references to relative assets that don't exist on disk are
  // collected here (by the `externals` resolver below) and surfaced as build
  // warnings — rather than hard-failing the build the way an unresolved module
  // normally would. A browser tolerates a missing background image/font (it
  // 404s it and still loads the extension), so vendored/third-party CSS that
  // ships without every referenced asset should not block the build.
  const missingCssAssets = new Set<string>()

  const plugins: NonNullable<Configuration['plugins']> = [
    new CompilationPlugin({
      manifestPath,
      browser: devOptions.browser,
      clean: devOptions.output.clean,
      zip: devOptions.zip === true,
      zipSource: devOptions.zipSource === true,
      zipFilename: devOptions.zipFilename,
      port:
        typeof devOptions.port === 'string'
          ? parseInt(devOptions.port, 10)
          : devOptions.port
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
      browser: devOptions.browser,
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
    }),
    // Extension-aware performance budgets (per-category thresholds tuned
    // for content scripts vs. service workers vs. cold UI pages). Replaces
    // rspack's stock single-threshold `performance.hints` — see the
    // `performance` block below where hints are disabled.
    new PerfBudgetsPlugin({budgets: devOptions.perfBudgets}),
    // Warn (don't fail) for CSS url() assets that were left unresolved because
    // the file is missing on disk. The url() is preserved verbatim in the
    // emitted CSS via the `externals` resolver below.
    {
      apply(compiler: any) {
        compiler.hooks.afterCompile.tap(
          'warn-missing-css-assets',
          (compilation: any) => {
            if (missingCssAssets.size === 0) return
            const ErrorCtor = compiler.rspack?.WebpackError || Error
            for (const request of missingCssAssets) {
              const warning = new ErrorCtor(
                `CSS asset "${request}" was not found on disk; the url() is left ` +
                  `unresolved. The browser requests it at runtime and loads the ` +
                  `extension regardless. Fix the path if it's a typo, or add the ` +
                  `asset if it should ship.`
              )
              warning.name = 'MissingCssAssetWarning'
              compilation.warnings.push(warning)
            }
            missingCssAssets.clear()
          }
        )
      }
    } as unknown as NonNullable<Configuration['plugins']>[number],
    // Warn (don't fail) when an MV2 source is built for a Chromium target. Chrome and
    // Edge no longer load Manifest V2, so the emitted bundle would silently fail to
    // install. Point the author at the realistic paths instead of shipping dead output.
    {
      apply(compiler: any) {
        const target = String(devOptions.browser)
        const isChromiumTarget =
          ['chrome', 'edge'].includes(target) || target.includes('chromium')
        if ((manifest as any)?.manifest_version !== 2 || !isChromiumTarget)
          return
        compiler.hooks.thisCompilation.tap(
          'warn-mv2-on-chromium',
          (compilation: any) => {
            const ErrorCtor = compiler.rspack?.WebpackError || Error
            const usesBlockingWebRequest =
              Array.isArray((manifest as any).permissions) &&
              (manifest as any).permissions.includes('webRequestBlocking')
            const warning = new ErrorCtor(
              [
                `This extension declares Manifest V2, which Chrome and Edge no longer load — `,
                `the ${target} build will not install. Options:`,
                ``,
                `  • Build for Firefox (still supports MV2):  extension build --browser firefox`,
                `  • Migrate the manifest to MV3 (action, background.service_worker, host_permissions)`,
                `  • Or ship both from one source with browser-prefixed keys`,
                `    (chromium:manifest_version: 3, firefox:manifest_version: 2, …)`,
                usesBlockingWebRequest
                  ? `\n  Note: this extension uses webRequestBlocking, which MV3 replaces with\n  declarativeNetRequest — a code change, not just a manifest edit.`
                  : ''
              ]
                .filter((line) => line !== '')
                .join('\n')
            )
            warning.name = 'ManifestV2OnChromiumWarning'
            compilation.warnings.push(warning)
          }
        )
      }
    } as unknown as NonNullable<Configuration['plugins']>[number]
  ]

  // The session/readiness contract (ready.json + events.ndjson) is written in
  // ALL dev modes, not just --no-browser. Headed sessions need it too: the agent
  // bridge's `extension logs --follow` and the act verbs (eval/storage/reload/
  // open) discover the control channel (controlPort/instanceId) from ready.json.
  plugins.push(
    new PlaywrightPlugin({
      packageJsonDir,
      browser: devOptions.browser,
      mode: devOptions.mode,
      outputPath: primaryExtensionOutputDir,
      manifestPath,
      port: devOptions.port,
      // Connectable host clients dial (HMR + control bridge). Resolved once by
      // dev-server/index.ts and exported via env; falls back to the bind host.
      host:
        process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST ||
        (devOptions as any).host,
      instanceId: devOptions.instanceId,
      controlPort: devOptions.controlPort,
      controlPath: devOptions.controlPath,
      logsPath: devOptions.logsPath
    })
  )

  // Wire the browser lifecycle plugin when a launcher is provided.
  // BrowsersPlugin wraps the browser API (programs/extension/browsers/)
  // behind rspack hooks — launching on first compile, reloading on
  // subsequent compiles, and emitting events for CLI telemetry.
  if (devOptions.browsersPlugin) {
    const browsersPlugin = devOptions.browsersPlugin
    browsersPlugin.extensionsToLoad = unpackedExtensionDirsToLoad
    plugins.push(browsersPlugin)
  }

  return {
    mode: devOptions.mode || 'development',
    entry: {},
    target: 'web',
    // `chrome-extension://` and `moz-extension://` URLs (commonly written as
    // `chrome-extension://__MSG_@@extension_id__/…` in CSS `url()` / `cursor`)
    // are runtime self-references resolved by the browser against the live
    // extension origin — not build-time modules. Mark them external so the
    // bundler leaves the string verbatim instead of trying to read the scheme
    // (which fails with "Unhandled scheme"). The `__MSG_@@extension_id__`
    // i18n placeholder is preserved untouched.
    externals: [
      (
        {
          request,
          dependencyType,
          context
        }: {request?: string; dependencyType?: string; context?: string},
        callback: (err?: null, result?: string, type?: string) => void
      ) => {
        if (typeof request !== 'string') return callback()

        if (/^(chrome|moz)-extension:|^safari-web-extension:/i.test(request)) {
          // Runtime extension-URL self-references (often
          // `…-extension://__MSG_@@extension_id__/…` in CSS `url()`/`cursor`).
          // `asset` external type emits the request verbatim as a URL string,
          // which is what both CSS `url()` and JS consumers expect. Safari uses
          // the `safari-web-extension:` scheme, so it must be matched alongside
          // Chromium's `chrome-extension:` and Firefox's `moz-extension:`.
          return callback(null, request, 'asset')
        }

        // A CSS url() (or new URL()) that points at a relative asset which is
        // not on disk: leave it verbatim instead of failing the build. Only
        // scheme-less, relative requests qualify, and only when the target file
        // genuinely doesn't exist — existing assets still resolve and bundle
        // normally. The missing path is recorded so it surfaces as a warning.
        if (
          dependencyType === 'url' &&
          context &&
          !/^[a-z][\w+.-]*:/i.test(request) && // no scheme (data:, http:, …)
          !/^[/#]/.test(request) && // not root-absolute or a bare fragment
          !request.startsWith('//')
        ) {
          const assetPath = request.split(/[?#]/)[0]
          try {
            if (assetPath && !fs.existsSync(path.resolve(context, assetPath))) {
              missingCssAssets.add(request)
              return callback(null, request, 'asset')
            }
          } catch {
            // Fall through to default resolution on any fs error.
          }
        }

        callback()
      }
    ] as any,
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
      filename:
        (devOptions.mode || 'development') === ('development' as any) &&
        devOptions.hashContentScripts !== false
          ? (pathData: {chunk?: {name?: string}}) => {
              const chunkName = pathData.chunk?.name
              if (
                typeof chunkName === 'string' &&
                /^content_scripts\/content-\d+$/.test(chunkName)
              ) {
                return `${chunkName}.[contenthash:8].js`
              }
              return '[name].js'
            }
          : '[name].js',
      // CSS output naming (cssFilename, cssChunkFilename) is owned by
      // CssPlugin — see plugin-css/index.ts.
      hotUpdateChunkFilename: 'hot/[id].[fullhash].hot-update.js',
      hotUpdateMainFilename: 'hot/[runtime].[fullhash].hot-update.json',
      environment: {
        bigIntLiteral: true,
        dynamicImport: true
      }
    },
    watchOptions: {
      // Ignore paths by SEGMENT, never by substring — a project that merely
      // has "dist" somewhere in its absolute path (a checkout named
      // "dedistract", a file named redistribute.js) must stay watched, or the
      // dev session silently never recompiles. Only the real build output,
      // installed deps, and browser profiles are exempt.
      ignored: [
        // When transpiling workspace packages from node_modules symlinks, avoid
        // blanket node_modules ignore so edits from those packages can trigger HMR.
        ...(transpilePackageDirs.length > 0 ? [] : ['**/node_modules/**']),
        `${toPosixPath(primaryExtensionOutputDir)}/**`,
        `${toPosixPath(path.join(packageJsonDir, 'dist'))}/**`,
        '**/extension-js/profiles/**'
      ],
      ...(process.env.EXTENSION_WATCH_POLL === 'true'
        ? {
            poll: parseInt(
              String(process.env.EXTENSION_WATCH_POLL_INTERVAL || '1000'),
              10
            )
          }
        : {}),
      aggregateTimeout: 200
    },
    resolve: {
      // Prefer browser fields and conditions; avoid Node-targeted builds
      mainFields: ['browser', 'module', 'main'],
      // Pick the right exports condition for the request kind. ESM imports
      // get `import`, CJS requires get `require` — packages like
      // `@babel/runtime` ship distinct files per condition, and using
      // `import` for a CJS `require()` returns an ESM namespace
      // (`{ default: fn }`) that the caller cannot invoke as a function
      conditionNames: ['browser', 'import', 'require', 'module', 'default'],
      byDependency: {
        esm: {
          conditionNames: ['browser', 'import', 'module', 'default']
        },
        commonjs: {
          conditionNames: ['browser', 'require', 'module', 'default']
        }
      },
      aliasFields: ['browser'],
      fallback: {
        crypto: false,
        fs: false,
        path: false
      },
      modules:
        projectStructure.packageJsonPath || projectStructure.denoJsonPath
          ? [
              'node_modules',
              path.join(packageJsonDir, 'node_modules'),
              path.join(process.cwd(), 'node_modules')
            ]
          : ['node_modules', path.join(process.cwd(), 'node_modules')],
      // TypeScript's NodeNext/ESM convention: the specifier names the EMITTED
      // file (`./env.js`) while the source on disk is `./env.ts`. Without this,
      // a standard strict-ESM TS extension fails with "Can't resolve './env.js'".
      // Source extensions come first so a `.js` specifier prefers the TS source,
      // falling back to a real `.js` sibling when there is no TS source.
      extensionAlias: {
        '.js': ['.ts', '.tsx', '.js', '.jsx'],
        '.mjs': ['.mts', '.mjs'],
        '.cjs': ['.cts', '.cjs']
      },
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
      // extension-develop bundles the optional preprocessor loaders
      // (less-loader, sass-loader, …). Add its node_modules as a resolution
      // fallback so those loaders can be referenced by bare name in the CSS
      // rules: the user project's own copy still wins (project chain first),
      // and the bundled copy is used otherwise — the same [project, develop]
      // order the old per-loader absolute-path resolution used.
      //
      // rspack treats absolute entries in `modules` as literal directories
      // with no node-style upward traversal, so we must list both places a
      // package manager can put the bundled loaders relative to
      // extension-develop: nested under its own node_modules (non-hoisted),
      // and — the common case — hoisted up as a sibling in the node_modules
      // that *contains* extension-develop. The old require.resolve-based
      // resolution walked up and so caught the hoisted copy for free; when
      // running via `npx`/`exec` extension-develop lives in the package
      // manager's cache and its deps are hoisted, which is why exec builds
      // failed to resolve sass-loader/less-loader without this parent entry.
      modules: [
        'node_modules',
        path.join(packageJsonDir, 'node_modules'),
        ...(() => {
          const developRoot = resolveDevelopInstallRoot()
          if (!developRoot) return []
          return [
            path.join(developRoot, 'node_modules'),
            path.dirname(developRoot)
          ]
        })()
      ],
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
      // PerfBudgetsPlugin (registered above) applies extension-aware,
      // per-category budgets. Disable rspack's stock single-threshold
      // hints so authors don't see two overlapping warnings for the same
      // asset, and so binary assets (images, fonts) don't trip a
      // code-splitting hint that doesn't apply to them.
      hints: false
    },
    optimization: {
      // Minify only in production to reduce bundle size
      minimize: devOptions.mode === 'production',
      // Honor package.json sideEffects for better tree-shaking
      sideEffects: true,
      // Mark used exports globally to help dead-code elimination
      usedExports: 'global',
      // Merge small modules for smaller, faster bundles in prod only.
      // In dev, scope hoisting interacts badly with @rspack/plugin-react-refresh:
      // when a vendor ESM module (e.g. tslib.es6.mjs) gets hoisted into a factory
      // that rspack names with CJS convention `(module, __webpack_exports__, ...)`,
      // the refresh prologue injected at the tail references `__webpack_module__`
      // — which is not the factory's parameter — yielding a
      // `__webpack_module__ is not defined` ReferenceError at runtime on sidebar/
      // newtab/HTML entries that pull in tslib transitively.
      concatenateModules: devOptions.mode === 'production',
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
