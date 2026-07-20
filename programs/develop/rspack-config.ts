// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compilation, Compiler, Configuration} from '@rspack/core'
import {makeSanitizedConsole} from './lib/branding'
import {isChromiumBasedBrowser} from './lib/constants'
import {resolveDevelopInstallRoot} from './lib/develop-context'
import {computeExtensionsToLoad} from './lib/extensions-to-load'
import {filterKeysForThisBrowser} from './lib/manifest-utils'
import * as messages from './lib/messages'
import {stripBom} from './lib/parse-json-safe'
import {asAbsolute, getDirs, toPosixPath} from './lib/paths'
import type {ProjectStructure} from './lib/project'
import {resolveTranspilePackageDirs} from './lib/transpile-packages'
import {CompatibilityPlugin} from './plugin-compatibility'
import {CompilationPlugin} from './plugin-compilation'
import {CssPlugin} from './plugin-css'
import {JsFrameworksPlugin} from './plugin-js-frameworks'
import {PerfBudgetsPlugin} from './plugin-perf-budgets'
import {PlaywrightPlugin} from './plugin-playwright'
import {ReloadPlugin} from './plugin-reload'
import {SpecialFoldersPlugin} from './plugin-special-folders'
import {resolveCompanionExtensionDirs} from './plugin-special-folders/folder-extensions/resolve-dirs'
import {StaticAssetsPlugin} from './plugin-static-assets'
import {WasmPlugin} from './plugin-wasm'
import {WebExtensionPlugin} from './plugin-web-extension'

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
    rawManifest as Parameters<typeof filterKeysForThisBrowser>[0],
    devOptions.browser
  )
  const primaryExtensionOutputDir = asAbsolute(
    path.isAbsolute(devOptions.output.path)
      ? devOptions.output.path
      : path.resolve(packageJsonDir, devOptions.output.path)
  )

  const companionUnpackedExtensionDirs = resolveCompanionExtensionDirs({
    projectRoot: packageJsonDir,
    config: devOptions.extensions
  })

  const unpackedExtensionDirsToLoad = computeExtensionsToLoad(
    // IMPORTANT: __dirname changes after publishing (compiled output in dist/).
    // Anchor at the develop package root so companion extensions stay stable.
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

  // CSS url() refs to missing relative assets, collected by the `externals`
  // resolver below and warned instead of failing (the browser tolerates them).
  const missingCssAssets = new Set<string>()

  // Bare require() calls that resolve to no module (dead server-runtime paths
  // in vendored scripts): collected below and warned, left verbatim in output.
  const unresolvedBareRequires = new Map<string, string>()

  // Node builtins stubbed via `resolve.fallback` below. The raw externals
  // resolver does not apply fallback, so the bare-require tolerance skips these.
  const nodeFallbacks: Record<string, false> = {
    crypto: false,
    fs: false,
    path: false
  }

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
    // Dev-only reload/HMR strategy. Must register AFTER WebExtensionPlugin,
    // whose declared entries it decorates. No-ops in production.
    new ReloadPlugin({
      manifestPath,
      browser: devOptions.browser
    }),
    new SpecialFoldersPlugin({
      manifestPath
    }),
    // Extension-aware per-category performance budgets. Replaces rspack's
    // stock single-threshold `performance.hints`, disabled below.
    new PerfBudgetsPlugin({budgets: devOptions.perfBudgets}),
    // Warn (don't fail) for CSS url() assets missing on disk. The url() is
    // preserved verbatim in the emitted CSS via the `externals` resolver below.
    {
      apply(compiler: Compiler) {
        compiler.hooks.afterCompile.tap(
          'warn-missing-css-assets',
          (compilation: Compilation) => {
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
    // Warn (don't fail) for bare require() calls that resolve nowhere. The
    // require stays verbatim in the bundle, matching how Chrome loads the script.
    {
      apply(compiler: Compiler) {
        compiler.hooks.afterCompile.tap(
          'warn-unresolved-bare-requires',
          (compilation: Compilation) => {
            if (unresolvedBareRequires.size === 0) return
            const ErrorCtor = compiler.rspack?.WebpackError || Error
            for (const [request, issuer] of unresolvedBareRequires) {
              const warning = new ErrorCtor(
                `require('${request}')${issuer ? ` in ${issuer}` : ''} does not ` +
                  `resolve to any module; the call is left verbatim in the output. ` +
                  `Chrome loads the script anyway. It only throws if that code path ` +
                  `runs (vendored pre-bundled libraries often carry dead require() ` +
                  `branches). Install the package if it's a real dependency, or set ` +
                  `EXTENSION_STRICT_REFS=true to make this fail the build.`
              )
              warning.name = 'UnresolvedBareRequireWarning'
              compilation.warnings.push(warning)
            }
            unresolvedBareRequires.clear()
          }
        )
      }
    } as unknown as NonNullable<Configuration['plugins']>[number],
    // Warn (don't fail) when an MV2 source is built for a Chromium target:
    // Chrome and Edge no longer load MV2, so the bundle would fail to install.
    {
      apply(compiler: Compiler) {
        const target = String(devOptions.browser)
        // Family classification: brave/opera/vivaldi/yandex drop MV2 too.
        const isChromiumTarget = isChromiumBasedBrowser(target)
        if (manifest?.manifest_version !== 2 || !isChromiumTarget) return
        compiler.hooks.thisCompilation.tap(
          'warn-mv2-on-chromium',
          (compilation: Compilation) => {
            const ErrorCtor = compiler.rspack?.WebpackError || Error
            const usesBlockingWebRequest =
              Array.isArray(manifest.permissions) &&
              (manifest.permissions as unknown[]).includes('webRequestBlocking')
            const warning = new ErrorCtor(
              [
                `This extension declares Manifest V2, which Chrome and Edge no longer load, `,
                `the ${target} build will not install. Options:`,
                ``,
                `  • Build for Firefox (still supports MV2):  extension build --browser firefox`,
                `  • Migrate the manifest to MV3 (action, background.service_worker, host_permissions)`,
                `  • Or ship both from one source with browser-prefixed keys`,
                `    (chromium:manifest_version: 3, firefox:manifest_version: 2, …)`,
                usesBlockingWebRequest
                  ? `\n  Note: this extension uses webRequestBlocking, which MV3 replaces with\n  declarativeNetRequest, a code change, not just a manifest edit.`
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

  // The readiness contract (ready.json + events.ndjson) is written in ALL dev
  // modes, not just --no-browser: logs --follow and act verbs discover it there.
  plugins.push(
    new PlaywrightPlugin({
      packageJsonDir,
      browser: devOptions.browser,
      mode: devOptions.mode,
      // Real command provenance: without it a one-shot `extension build`
      // receipt claims "start" (derived from mode: production).
      command: devOptions.metadataCommand,
      outputPath: primaryExtensionOutputDir,
      manifestPath,
      port: devOptions.port,
      // Connectable host clients dial (HMR + control bridge). Resolved once by
      // dev-server/index.ts and exported via env; falls back to the bind host.
      host:
        process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST ||
        (devOptions as {host?: string}).host,
      instanceId: devOptions.instanceId,
      controlPort: devOptions.controlPort,
      controlPath: devOptions.controlPath,
      logsPath: devOptions.logsPath
    })
  )

  if (devOptions.browsersPlugin) {
    const browsersPlugin = devOptions.browsersPlugin
    browsersPlugin.extensionsToLoad = unpackedExtensionDirsToLoad
    plugins.push(browsersPlugin)
  }

  return {
    mode: devOptions.mode || 'development',
    entry: {},
    target: 'web',
    // chrome-extension:// and moz-extension:// URLs are runtime self-references
    // the browser resolves; mark external so the bundler leaves them verbatim.
    externals: [
      (
        {
          request,
          dependencyType,
          context,
          contextInfo,
          getResolve
        }: {
          request?: string
          dependencyType?: string
          context?: string
          contextInfo?: {issuer: string}
          getResolve?: () => (
            context: string,
            request: string,
            callback: (err?: Error | null, result?: string | false) => void
          ) => void
        },
        callback: (err?: null, result?: string, type?: string) => void
      ) => {
        if (typeof request !== 'string') return callback()

        if (/^(chrome|moz)-extension:|^safari-web-extension:/i.test(request)) {
          // Runtime extension-URL self-references: `asset` external emits the
          // request verbatim. Safari's safari-web-extension: scheme counts too.
          return callback(null, request, 'asset')
        }

        // A CSS url()/new URL() to a relative asset missing on disk: leave it
        // verbatim instead of failing; recorded so it surfaces as a warning.
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

        // Bare require() that resolves nowhere: externalize as 'commonjs' so the
        // bundle keeps it verbatim like Chrome; EXTENSION_STRICT_REFS restores the error.
        if (
          dependencyType === 'commonjs' &&
          context &&
          typeof getResolve === 'function' &&
          process.env.EXTENSION_STRICT_REFS !== 'true' &&
          !(request in nodeFallbacks) && // resolve.fallback owns these
          !/^[a-z][\w+.-]*:/i.test(request) && // no scheme (node:, data:, …)
          !request.startsWith('.') &&
          !request.startsWith('/') &&
          !path.isAbsolute(request)
        ) {
          const resolve = getResolve()
          resolve(context, request, (err, result) => {
            if (err || !result) {
              if (!unresolvedBareRequires.has(request)) {
                unresolvedBareRequires.set(request, contextInfo?.issuer || '')
              }
              callback(null, request, 'commonjs')
            } else {
              callback()
            }
          })
          return
        }

        callback()
      }
    ] as Configuration['externals'],
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
      publicPath: '/',
      filename:
        (devOptions.mode || 'development') === 'development' &&
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
      // CssPlugin, see plugin-css/index.ts.
      hotUpdateChunkFilename: 'hot/[id].[fullhash].hot-update.js',
      hotUpdateMainFilename: 'hot/[runtime].[fullhash].hot-update.json',
      environment: {
        bigIntLiteral: true,
        dynamicImport: true
      }
    },
    watchOptions: {
      // Ignore paths by SEGMENT, never by substring: a path merely containing
      // "dist" must stay watched or the dev session silently never recompiles.
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
      // ESM imports get `import`, CJS requires get `require`: using `import`
      // for a CJS require() returns an ESM namespace the caller cannot invoke.
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
      fallback: nodeFallbacks,
      modules:
        projectStructure.packageJsonPath || projectStructure.denoJsonPath
          ? [
              'node_modules',
              path.join(packageJsonDir, 'node_modules'),
              path.join(process.cwd(), 'node_modules')
            ]
          : ['node_modules', path.join(process.cwd(), 'node_modules')],
      // Root-absolute url(/img/x.png) in compiled CSS is a module request;
      // `roots` maps it: public/ first, then the manifest dir (not always package root).
      roots: [path.join(packageJsonDir, 'public'), path.dirname(manifestPath)],
      // TS NodeNext specifiers name the EMITTED file (./env.js) while source is
      // ./env.ts. Prefer TS sources for .js, falling back to a real .js sibling.
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
      // Bundled preprocessor loaders resolve by bare name: project copy wins,
      // then extension-develop's own and hoisted node_modules (no upward walk).
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
      // Allow CSS Modules default imports in addition to namespace and named
      // imports. See https://rspack.dev/guide/tech/css#css-modules
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
      console: makeSanitizedConsole('Extension.js') as unknown as NonNullable<
        Configuration['infrastructureLogging']
      >['console']
    },
    performance: {
      // PerfBudgetsPlugin applies extension-aware per-category budgets. Disable
      // rspack's stock single-threshold hints to avoid overlapping warnings.
      hints: false
    },
    optimization: {
      // A failed compile must not overwrite the last-good build on disk: rspack
      // defaults to true, which shipped error-stub modules into dist/.
      emitOnErrors: false,
      minimize: devOptions.mode === 'production',
      sideEffects: true,
      usedExports: 'global',
      // Concatenate modules in prod only: in dev, scope hoisting breaks
      // @rspack/plugin-react-refresh with a __webpack_module__ ReferenceError.
      concatenateModules: devOptions.mode === 'production',
      // Keep a single file per entry (extensions expect static file names)
      splitChunks: false,
      runtimeChunk: false,
      moduleIds: 'deterministic',
      chunkIds: 'deterministic'
    },
    experiments: {
      css: true
    }
  }
}
