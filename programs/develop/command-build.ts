// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import {getBuildSummary, type BuildSummary} from './lib/build-summary'
import type {Configuration} from '@rspack/core'
import {getProjectStructure} from './lib/project'
import * as messages from './lib/messages'
import {loadCustomConfig} from './lib/config-loader'
import {loadCommandConfig} from './lib/config-loader'
import {assertNoManagedDependencyConflicts} from './lib/validate-user-dependencies'
import {getDirs, getDistPath, normalizeBrowser} from './lib/paths'
import {
  ensureDevelopArtifacts,
  ensureUserProjectDependencies
} from './lib/ensure-develop-artifacts'
import {resolveCompanionExtensionsConfig} from './plugin-special-folders/folder-extensions/resolve-config'
import {getSpecialFoldersDataForProjectRoot} from './plugin-special-folders/get-data'

import type {BuildOptions} from './types'

export async function extensionBuild(
  pathOrRemoteUrl: string | undefined,
  buildOptions?: BuildOptions
): Promise<BuildSummary> {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)
  const isVitest = process.env.VITEST === 'true'
  const shouldExitOnError = (buildOptions?.exitOnError ?? true) && !isVitest
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

    // Heavy deps are intentionally imported lazily so `preview` can run with a minimal install.
    const [{rspack}, {merge}, {handleStatsErrors}, {default: webpackConfig}] =
      await Promise.all([
        import('@rspack/core'),
        import('webpack-merge'),
        import('./lib/stats-handler'),
        import('./rspack-config')
      ])

    const debug = isAuthor
    // Guard: only error if user references managed deps in extension.config.js
    if (projectStructure.packageJsonPath) {
      assertNoManagedDependencyConflicts(
        projectStructure.packageJsonPath,
        manifestDir
      )
    }

    const commandConfig = await loadCommandConfig(packageJsonDir, 'build')
    const specialFoldersData =
      getSpecialFoldersDataForProjectRoot(packageJsonDir)

    const distPath = getDistPath(packageJsonDir, browser)

    // Vite-style `emptyOutDir` semantics: wipe the per-browser dist before the
    // build so the output is deterministic regardless of prior `extension dev`
    // runs (which leave stale hashed bundles behind under `output.clean: false`)
    // or any rspack-side regression in `output.clean`. Cheap, idempotent, and
    // matches what users intuit from running `build`
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

    // Mode override: defaults to 'production' for distribution-ready dists.
    // Surfacing this as a CLI flag matches Vite/webpack and lets users
    // produce a dev-mode dist without flipping to `extension dev`. NODE_ENV
    // is aligned to mode so user-source `process.env.NODE_ENV` reflects the
    // intent and downstream tooling that keys off it (React, etc.) gets the
    // expected build behavior.
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
      compiler.run(async (err: any, stats: any) => {
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
          console.log(messages.buildWebpack(manifestDir, stats, browser))
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
          // Print sanitized bundler output using stats.toString
          handleStatsErrors(stats)

          if (!shouldExitOnError) {
            return reject(new Error('Build failed with errors'))
          }
          process.exit(1)
        }
      })
    })

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
