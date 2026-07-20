// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import type {Configuration} from '@rspack/core'
import {type BuildSummary, getBuildSummary} from './lib/build-summary'
import {
  loadBrowserConfig,
  loadCommandConfig,
  loadCustomConfig
} from './lib/config-loader'
import {
  ensureDevelopArtifacts,
  ensureUserProjectDependencies
} from './lib/ensure-develop-artifacts'
import {generateExtensionTypes} from './lib/generate-extension-types'
import * as messages from './lib/messages'
import {getDirs, getDistPath, normalizeBrowser} from './lib/paths'
import {getProjectStructure} from './lib/project'
import {
  buildSummaryPath,
  ensureSessionArtifactsIgnoreFile
} from './lib/session-paths'
import {assertNoManagedDependencyConflicts} from './lib/validate-user-dependencies'
import {
  ensureTypeScriptConfig,
  isUsingTypeScript
} from './plugin-js-frameworks/js-tools/typescript'
import {resolveCompanionExtensionsConfig} from './plugin-special-folders/folder-extensions/resolve-config'
import {getSpecialFoldersDataForProjectRoot} from './plugin-special-folders/get-data'

import type {BuildOptions} from './types'

export async function extensionBuild(
  pathOrRemoteUrl: string | undefined,
  buildOptions?: BuildOptions
): Promise<BuildSummary> {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)
  const isVitest = process.env.VITEST === 'true'
  // The CLI wrapper passes exitOnError=true; as a library import a failed
  // build must be a rejected promise, never a process.exit inside the host.
  const shouldExitOnError = (buildOptions?.exitOnError ?? false) && !isVitest
  const browser = normalizeBrowser(
    buildOptions?.browser || 'chrome',
    buildOptions?.chromiumBinary,
    buildOptions?.geckoBinary || buildOptions?.firefoxBinary
  )

  const {manifestDir, packageJsonDir} = getDirs(projectStructure)
  const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'

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
    const [{rspack}, {merge}, {handleStatsErrors}, {default: webpackConfig}] =
      await Promise.all([
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

    const commandConfig = await loadCommandConfig(packageJsonDir, 'build')
    const specialFoldersData =
      getSpecialFoldersDataForProjectRoot(packageJsonDir)

    const distPath = getDistPath(packageJsonDir, browser)

    // Vite-style `emptyOutDir`: wipe the per-browser dist before the build so
    // output is deterministic despite stale hashed bundles from prior dev runs.
    try {
      fs.rmSync(distPath, {recursive: true, force: true})
    } catch {
      // Best-effort; rspack will still emit into the directory.
    }

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
      ...commandConfig,
      ...buildOptions,
      extensions: resolvedExtensionsConfig,
      browser,
      mode: resolvedMode,
      metadataCommand: buildOptions?.metadataCommand || 'build',
      output: {
        clean: true,
        path: distPath
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
    const compiler = rspack(compilerConfig)

    let summary: BuildSummary = {
      browser,
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
          return reject(err)
        }

        // Guard against silent-success scenarios where the bundler callback
        // does not provide stats, which means we cannot trust emission output.
        if (!stats || typeof stats.hasErrors !== 'function') {
          return reject(
            new Error(
              'Build failed: bundler returned invalid stats output (no reliable compilation result).'
            )
          )
        }

        if (!buildOptions?.silent && stats) {
          // The summary is informational; a throw here would leave this promise
          // pending and the process would exit 0 before the error handling below.
          try {
            console.log(messages.buildWebpack(manifestDir, stats, browser))
          } catch {
            // Ignore summary failures; error reporting happens below.
          }
        }

        if (!stats.hasErrors()) {
          // Anonymized aggregates (no filenames or paths)
          const info = stats?.toJson({
            all: false,
            assets: true,
            warnings: true,
            errors: true
          })

          summary = getBuildSummary(browser, info)

          // Hosts that shell out to `extension build` cannot see the returned
          // summary, so persist it next to ready.json. Best-effort only.
          try {
            const summaryFile = buildSummaryPath(packageJsonDir, browser)
            fs.mkdirSync(nodePath.dirname(summaryFile), {recursive: true})
            ensureSessionArtifactsIgnoreFile(packageJsonDir)
            fs.writeFileSync(summaryFile, JSON.stringify(summary))
          } catch {
            // Never fail a green build over the informational contract.
          }

          if (summary.warnings_count > 0) {
            console.log(
              messages.buildSuccessWithWarnings(summary.warnings_count)
            )
            const warningDetails = messages.buildWarningsDetails(
              info?.warnings || []
            )

            if (warningDetails) {
              console.log(`\n${warningDetails}`)
            }
          } else {
            console.log(messages.buildSuccess())
          }
          resolve()
        } else {
          handleStatsErrors(stats)

          if (!shouldExitOnError) {
            return reject(new Error('Build failed with errors'))
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

      await buildOptions.safariPackager(distPath, 'full', {
        appName: buildOptions.appName ?? safariConfig.appName,
        bundleId: buildOptions.bundleId ?? safariConfig.bundleId,
        macOsOnly: buildOptions.macOsOnly ?? safariConfig.macOsOnly,
        forceRegenerate: buildOptions.forceRegenerate,
        safariBinary: buildOptions.safariBinary ?? safariConfig.safariBinary
      })
    }

    return summary
  } catch (error) {
    const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'
    if (isAuthor) {
      console.error(error)
    } else {
      console.error(messages.buildCommandFailed(error))
    }
    if (!shouldExitOnError) {
      throw error
    }
    process.exit(1)
  }
}
