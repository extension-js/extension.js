// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import type {Configuration} from '@rspack/core'
import {humanLine} from './dev-server/lifecycle-stream'
import {
  promoteStagingDist,
  removeStagingDir,
  removeStaleStagingDirs,
  stagingDistPathFor
} from './lib/atomic-dist'
import {type BuildSummary, getBuildSummary} from './lib/build-summary'
import {
  loadBrowserConfig,
  loadCommandConfig,
  loadCustomConfig,
  loadProjectConfigDefaults
} from './lib/config-loader'
import {
  ensureDevelopArtifacts,
  ensureUserProjectDependencies
} from './lib/ensure-develop-artifacts'
import {generateExtensionTypes} from './lib/generate-extension-types'
import {
  BUILD_COMMAND_DEFAULTS,
  mergeOptionLayers,
  START_BUILD_DEFAULTS
} from './lib/merge-options'
import * as messages from './lib/messages'
import {browserRowValue, card, claimCardKey, isDebug} from './lib/messaging'
import {parseJsonSafe} from './lib/parse-json-safe'
import {
  configBrowserOrThrow,
  getDirs,
  getDistPath,
  normalizeBrowser
} from './lib/paths'
import {getProjectStructure} from './lib/project'
import {
  buildSummaryPath,
  ensureSessionArtifactsIgnoreFile,
  ensureSessionStateInProjectGitignore
} from './lib/session-paths'
import {assertNoManagedDependencyConflicts} from './lib/validate-user-dependencies'
import {getZipArtifacts} from './plugin-compilation/zip-artifacts'
import {
  ensureTypeScriptConfig,
  isUsingTypeScript
} from './plugin-js-frameworks/js-tools/typescript'
import {
  stampReadyDistExtensionId,
  stampReadyKnownExtensionId
} from './plugin-playwright'
import {resolveCompanionExtensionsConfig} from './plugin-special-folders/folder-extensions/resolve-config'
import {getSpecialFoldersDataForProjectRoot} from './plugin-special-folders/get-data'
import type {BuildOptions} from './types'

function collapseHomeDir(value: string): string {
  const home = os.homedir()
  if (!home || !value.startsWith(home)) return value
  const rest = value.slice(home.length)
  if (rest === '') return '~'
  if (rest.startsWith(nodePath.sep) || rest.startsWith('/')) return `~${rest}`
  return value
}

function relativeToCwd(target: string): string | null {
  const relative = nodePath.relative(process.cwd(), target)
  if (
    relative &&
    !relative.startsWith('..') &&
    !nodePath.isAbsolute(relative)
  ) {
    return relative
  }
  return null
}

const reportedBuildFailures = new WeakSet<object>()

// The card is the session header, printed before the first work line, and its
// key is what lets `start` dedupe the preview leg instead of reprinting.
function printBuildCard(
  manifestPath: string,
  browser: string,
  distPath: string
) {
  if (!claimCardKey(`${browser}::${nodePath.resolve(distPath)}`)) return

  let extensionLabel = ''
  try {
    const manifest = parseJsonSafe(fs.readFileSync(manifestPath, 'utf-8'))
    const name = String(manifest?.name || '').trim()
    const version = String(manifest?.version || '').trim()
    extensionLabel = name && version ? `${name} ${version}` : name
  } catch {
    // Ignore
  }

  const browserLabel = browserRowValue(String(browser || ''))
  const suffix = process.env.EXTENSION_CLI_UPDATE_SUFFIX || ''
  if (suffix) delete process.env.EXTENSION_CLI_UPDATE_SUFFIX

  humanLine(' ')
  humanLine(
    card({
      version:
        process.env.EXTENSION_DEVELOP_VERSION ||
        process.env.EXTENSION_CLI_VERSION,
      suffix,
      rows: [
        {label: 'Browser', value: browserLabel},
        {label: 'Extension', value: extensionLabel},
        {label: 'Output', value: collapseHomeDir(distPath)}
      ]
    })
  )
  humanLine(' ')
  process.env.EXTENSION_CLI_BANNER_PRINTED = 'true'
}

export async function extensionBuild(
  pathOrRemoteUrl: string | undefined,
  buildOptions?: BuildOptions
): Promise<BuildSummary> {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)
  const isVitest = process.env.VITEST === 'true'
  // The CLI wrapper passes exitOnError=true; as a library import a failed
  // build must be a rejected promise, never a process.exit inside the host.
  const shouldExitOnError = (buildOptions?.exitOnError ?? false) && !isVitest
  const {manifestDir, packageJsonDir} = getDirs(projectStructure)

  // `extension start` builds with commands.start values, polyfill on by
  // default and a silent build. Plain `extension build` uses commands.build.
  const commandKey =
    buildOptions?.metadataCommand === 'start' ? 'start' : 'build'

  // A browser passed in wins; with none, commands.<cmd>.browser from the
  // project config decides the target before the stock default does.
  const configBrowser = buildOptions?.browser
    ? undefined
    : configBrowserOrThrow(
        (await loadCommandConfig(packageJsonDir, commandKey)).browser,
        commandKey
      )
  const browser = normalizeBrowser(
    buildOptions?.browser || configBrowser || 'chrome',
    buildOptions?.chromiumBinary,
    buildOptions?.geckoBinary || buildOptions?.firefoxBinary,
    buildOptions?.safariBinary
  )

  const distPath = getDistPath(packageJsonDir, browser)
  // Assets are emitted into this staging sibling and a rename publishes it,
  // so an interrupted build can never leave a manifest without its pages.
  const stagingDistPath = stagingDistPathFor(distPath)
  const isAuthor = isDebug()

  try {
    await ensureDevelopArtifacts()
    if (buildOptions?.install !== false) {
      await ensureUserProjectDependencies(packageJsonDir)
    }

    ensureTypeScriptConfig(manifestDir)

    if (isUsingTypeScript(manifestDir)) {
      await generateExtensionTypes(manifestDir, packageJsonDir)
    }

    // Heavy deps are intentionally imported lazily so `preview` can run with a minimal install.
    const [
      {rspack},
      {merge},
      {handleStatsErrors, isEmitTimeWarning},
      {default: webpackConfig}
    ] = await Promise.all([
      import('@rspack/core'),
      import('webpack-merge'),
      import('./lib/stats-handler'),
      import('./rspack-config')
    ])

    const debug = isAuthor
    const userManifestPath =
      projectStructure.packageJsonPath || projectStructure.denoJsonPath
    if (userManifestPath) {
      assertNoManagedDependencyConflicts(userManifestPath, manifestDir)
    }

    const projectConfig = await loadProjectConfigDefaults(packageJsonDir)
    const commandConfig = await loadCommandConfig(packageJsonDir, commandKey)
    const browserConfig = await loadBrowserConfig(packageJsonDir, browser)
    const specialFoldersData =
      getSpecialFoldersDataForProjectRoot(packageJsonDir)

    // stock defaults, then top-level config, then browser.*, then command
    // config, then CLI. Unset CLI keys are stripped so config wins. An
    // explicit flag beats it. The browser layer matches dev:
    // browser.<x>.transpilePackages and friends must not vanish between dev and build.
    const mergedBuildOptions = mergeOptionLayers<BuildOptions>(
      commandKey === 'start' ? START_BUILD_DEFAULTS : BUILD_COMMAND_DEFAULTS,
      projectConfig,
      browserConfig,
      commandConfig,
      buildOptions
    )
    const silent = Boolean(mergedBuildOptions.silent)

    // Vite-style `emptyOutDir` determinism now comes from the staging swap:
    // the fresh staging dir replaces dist/<browser> wholesale on success, so
    // stale hashed bundles vanish while last-good survives a failed build.
    removeStaleStagingDirs(distPath)

    if (debug) {
      console.log(messages.debugDirs(manifestDir, packageJsonDir))
      console.log(
        messages.debugBrowser(
          browser,
          buildOptions?.chromiumBinary,
          buildOptions?.geckoBinary || buildOptions?.firefoxBinary
        )
      )
      console.log(messages.debugOutputPath(distPath))
    }

    const mergedExtensionsConfig =
      buildOptions?.extensions ??
      commandConfig.extensions ??
      browserConfig.extensions ??
      projectConfig.extensions ??
      specialFoldersData.extensions
    const resolvedExtensionsConfig = await resolveCompanionExtensionsConfig({
      projectRoot: packageJsonDir,
      browser,
      config: mergedExtensionsConfig
    })

    const resolvedMode: 'development' | 'production' | 'none' =
      buildOptions?.mode === 'development' ||
      buildOptions?.mode === 'none' ||
      buildOptions?.mode === 'production'
        ? buildOptions.mode
        : 'production'
    if (resolvedMode === 'development' || resolvedMode === 'production') {
      process.env.NODE_ENV = resolvedMode
    }

    const baseConfig: Configuration = webpackConfig(projectStructure, {
      ...mergedBuildOptions,
      extensions: resolvedExtensionsConfig,
      browser,
      mode: resolvedMode,
      metadataCommand: buildOptions?.metadataCommand || 'build',
      output: {
        clean: false,
        path: stagingDistPath,
        finalPath: distPath
      }
    })

    const allPluginsButBrowserRunners = baseConfig.plugins?.filter((plugin) => {
      return plugin?.constructor.name !== 'plugin-browsers'
    })

    const userExtensionConfig = await loadCustomConfig(packageJsonDir)
    const userConfig = userExtensionConfig({
      ...baseConfig,
      plugins: allPluginsButBrowserRunners
    })

    const compilerConfig = merge(userConfig)
    compilerConfig.stats = false

    // A user config that re-points output.path opts out of the staging swap
    // and keeps the legacy direct-emit contract, including the upfront wipe.
    // The bundler resolves a relative output.path against the compiler
    // context, never the shell's cwd, so the wipe, the receipt and the zip
    // remap must resolve it the same way or a build run from another folder
    // deletes that folder's build/ and reports a directory nothing landed in.
    const compileContext =
      typeof compilerConfig.context === 'string' && compilerConfig.context
        ? nodePath.resolve(compilerConfig.context)
        : packageJsonDir
    const mergedOutputPath =
      typeof compilerConfig.output?.path === 'string'
        ? nodePath.resolve(compileContext, compilerConfig.output.path)
        : ''
    const useStagingSwap =
      mergedOutputPath === nodePath.resolve(stagingDistPath)
    // The receipt must name the directory artifacts actually land in, which
    // under a re-pointed output.path is not dist/<browser>.
    const displayDistPath =
      useStagingSwap || !mergedOutputPath ? distPath : mergedOutputPath
    if (!useStagingSwap && mergedOutputPath) {
      try {
        fs.rmSync(mergedOutputPath, {recursive: true, force: true})
      } catch {
        // Ignore
      }
    }

    const compiler = rspack(compilerConfig)

    let summary: BuildSummary = {
      browser,
      output_path: distPath,
      total_assets: 0,
      total_bytes: 0,
      largest_asset_bytes: 0,
      warnings_count: 0,
      errors_count: 0
    }

    await new Promise<void>((resolve, reject) => {
      compiler.run(async (err, stats) => {
        if (err) {
          console.error(err.stack || err)
          removeStagingDir(stagingDistPath)
          return reject(err)
        }

        // Guard against silent-success scenarios where the bundler callback
        // does not provide stats, which means we cannot trust emission output.
        if (!stats || typeof stats.hasErrors !== 'function') {
          removeStagingDir(stagingDistPath)
          return reject(
            new Error(
              'Build failed: bundler returned invalid stats output (no reliable compilation result).'
            )
          )
        }

        // The identity card and asset tree are informational; a throw here
        // would leave this promise pending and the process would exit 0.
        try {
          printBuildCard(
            projectStructure.manifestPath,
            browser,
            displayDistPath
          )

          if (!silent) {
            const assetsTree = messages.buildAssetsTree(stats)
            if (assetsTree) humanLine(assetsTree)
          }
        } catch {
          // Ignore
        }

        if (!stats.hasErrors()) {
          // Publish the finished staging dir before any success receipt so a
          // green line is never printed over a half-populated dist.
          if (useStagingSwap && fs.existsSync(stagingDistPath)) {
            try {
              promoteStagingDist(stagingDistPath, distPath)
            } catch (promoteError) {
              removeStagingDir(stagingDistPath)
              return reject(promoteError)
            }
            stampReadyDistExtensionId(packageJsonDir, browser, distPath)
          }

          // Anonymized aggregates (no filenames or paths)
          const info = stats?.toJson({
            all: false,
            assets: true,
            warnings: true,
            errors: true
          })

          // The summary names the folder the artifacts landed in, which under
          // a re-pointed output.path is not dist/<browser>.
          summary = getBuildSummary(browser, info, displayDistPath)

          // Hosts that shell out to `extension build` cannot see the returned
          // summary, so persist it next to ready.json. Best-effort only.
          try {
            const summaryFile = buildSummaryPath(packageJsonDir, browser)
            fs.mkdirSync(nodePath.dirname(summaryFile), {recursive: true})
            ensureSessionArtifactsIgnoreFile(packageJsonDir)
            ensureSessionStateInProjectGitignore(packageJsonDir)
            fs.writeFileSync(summaryFile, JSON.stringify(summary))
          } catch {
            // Never fail a green build over the informational contract.
          }

          if (summary.warnings_count > 0) {
            // Emit-time warnings already printed when the plugin acted; the
            // summary keeps them all so the json record stays complete.
            const warningDetails = messages.buildWarningsDetails(
              (info?.warnings || []).filter(
                (warning) => !isEmitTimeWarning(warning)
              )
            )

            if (warningDetails) {
              humanLine(warningDetails)
            }
          }

          const distDisplay =
            relativeToCwd(displayDistPath) || collapseHomeDir(displayDistPath)
          humanLine(
            messages.buildComplete(browser, distDisplay, summary.total_bytes)
          )

          for (const artifact of getZipArtifacts(stats.compilation)) {
            // Zips created inside the staging dir moved with the promote.
            const artifactPath =
              useStagingSwap && artifact.path.startsWith(stagingDistPath)
                ? distPath + artifact.path.slice(stagingDistPath.length)
                : artifact.path
            const zipDisplay = relativeToCwd(artifactPath) || artifactPath
            humanLine(messages.zipArtifactReady(zipDisplay, artifact.size))
          }
          const shareHint = messages.buildShareHint()
          if (shareHint) humanLine(shareHint)
          resolve()
        } else {
          // A failed compile keeps the last-good dist: nothing was written to
          // dist/<browser>, only the staging dir, which is discarded here.
          removeStagingDir(stagingDistPath)
          handleStatsErrors(stats)

          let errorCount = 1
          try {
            const info = stats.toJson({all: false, errors: true})
            errorCount = Math.max(1, info?.errors?.length || 1)
          } catch {
            // Ignore
          }
          console.error(messages.buildFailed(errorCount))

          if (!shouldExitOnError) {
            const failure = new Error('Build failed with errors')
            reportedBuildFailures.add(failure)
            return reject(failure)
          }
          process.exit(1)
        }
      })
    })

    // Safari is packaged from the freshly built dist; the packager is injected
    // by the CLI so develop stays decoupled. CLI flags win over `browser.safari`.
    if (
      (browser === 'safari' || browser === 'webkit-based') &&
      buildOptions?.safariPackager
    ) {
      const safariConfig = await loadBrowserConfig(packageJsonDir, browser)

      const safari = await buildOptions.safariPackager(distPath, 'full', {
        appName: buildOptions.appName ?? safariConfig.appName,
        bundleId: buildOptions.bundleId ?? safariConfig.bundleId,
        developmentTeam:
          buildOptions.developmentTeam ?? safariConfig.developmentTeam,
        macOsOnly: buildOptions.macOsOnly ?? safariConfig.macOsOnly,
        forceRegenerate: buildOptions.forceRegenerate,
        safariBinary: buildOptions.safariBinary ?? safariConfig.safariBinary
      })

      // The app identity (and whether the bundle id was generated rather than
      // user-owned) was a human log line only. Fold it into the summary so a
      // programmatic caller does not have to read project.pbxproj to learn it.
      if (safari) {
        summary = {...summary, safari}
        try {
          fs.writeFileSync(
            buildSummaryPath(packageJsonDir, browser),
            JSON.stringify(summary)
          )
        } catch {
          // Never fail a green build over the informational contract.
        }
        // Safari registers the extension under the appex identity,
        // `<bundleId>.Extension`, so that is the truthful ready.json id.
        if (safari.bundleId) {
          stampReadyKnownExtensionId(
            packageJsonDir,
            browser,
            `${safari.bundleId}.Extension`
          )
        }
      }
    }

    return summary
  } catch (error) {
    removeStagingDir(stagingDistPath)
    const alreadyReported =
      error instanceof Error && reportedBuildFailures.has(error)
    if (!alreadyReported) {
      if (isDebug()) {
        console.error(error)
      } else {
        console.error(messages.buildCommandFailed(error))
      }
      console.error(messages.buildFailed(1))
    }
    if (!shouldExitOnError) {
      throw error
    }
    process.exit(1)
  }
}
