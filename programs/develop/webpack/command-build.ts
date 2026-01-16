// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {getProjectStructure} from './webpack-lib/project'
import * as messages from './webpack-lib/messages'
import {loadCustomWebpackConfig} from './webpack-lib/config-loader'
import {loadCommandConfig} from './webpack-lib/config-loader'
import {installDependencies} from './webpack-lib/install-dependencies'
import {assertNoManagedDependencyConflicts} from './webpack-lib/validate-user-dependencies'
import {
  getDirs,
  getDistPath,
  needsInstall,
  normalizeBrowser
} from './webpack-lib/paths'
import {getBuildSummary, type BuildSummary} from './webpack-lib/build-summary'
import type {Configuration} from '@rspack/core'
import {
  areBuildDependenciesInstalled,
  getMissingBuildDependencies,
  findExtensionDevelopRoot
} from './webpack-lib/check-build-dependencies'
import {installOwnDependencies} from './webpack-lib/install-own-dependencies'

import type {BuildOptions} from './webpack-types'

export async function extensionBuild(
  pathOrRemoteUrl: string | undefined,
  buildOptions?: BuildOptions
): Promise<BuildSummary> {
  // Check and install build dependencies if needed
  const packageRoot = findExtensionDevelopRoot()
  if (packageRoot && !areBuildDependenciesInstalled(packageRoot)) {
    const missing = getMissingBuildDependencies(packageRoot)
    await installOwnDependencies(missing, packageRoot)
  }

  const projectStructure = await getProjectStructure(pathOrRemoteUrl)
  const isVitest = process.env.VITEST === 'true'
  const shouldExitOnError = (buildOptions?.exitOnError ?? true) && !isVitest
  const browser = normalizeBrowser(
    buildOptions?.browser || 'chrome',
    buildOptions?.chromiumBinary,
    buildOptions?.geckoBinary || buildOptions?.firefoxBinary
  )

  try {
    // Heavy deps are intentionally imported lazily so `preview` can run with a minimal install.
    const [{rspack}, {merge}, {handleStatsErrors}, {default: webpackConfig}] =
      await Promise.all([
        import('@rspack/core'),
        import('webpack-merge'),
        import('./webpack-lib/stats-handler'),
        import('./webpack-config')
      ])

    const debug = process.env.EXTENSION_AUTHOR_MODE === 'true'
    const {manifestDir, packageJsonDir} = getDirs(projectStructure)

    // Guard: only error if user references managed deps in extension.config.js
    if (projectStructure.packageJsonPath) {
      assertNoManagedDependencyConflicts(
        projectStructure.packageJsonPath,
        manifestDir
      )
    }

    const commandConfig = await loadCommandConfig(manifestDir, 'build')

    const distPath = getDistPath(packageJsonDir, browser)
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

    const baseConfig: Configuration = webpackConfig(projectStructure, {
      ...commandConfig,
      ...buildOptions,
      browser,
      mode: 'production',
      output: {
        clean: true,
        path: distPath
      }
    })

    const allPluginsButBrowserRunners = baseConfig.plugins?.filter((plugin) => {
      return plugin?.constructor.name !== 'plugin-browsers'
    })

    const userExtensionConfig = await loadCustomWebpackConfig(manifestDir)
    const userConfig = userExtensionConfig({
      ...baseConfig,
      plugins: allPluginsButBrowserRunners
    })

    const compilerConfig = merge(userConfig)
    const compiler = rspack(compilerConfig)

    // Install dependencies if they are not installed (skip in web-only mode).
    if (projectStructure.packageJsonPath) {
      if (needsInstall(packageJsonDir)) {
        console.log(messages.installingDependencies())

        // Prevents `process.chdir() is not supported in workers` error
        if (process.env.VITEST !== 'true') {
          await installDependencies(packageJsonDir)
        }
      }
    }

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

        if (!buildOptions?.silent && stats) {
          console.log(messages.buildWebpack(manifestDir, stats, browser))
        }

        if (!stats?.hasErrors()) {
          // Anonymized aggregates (no filenames or paths)
          const info = stats?.toJson({
            assets: true,
            warnings: true,
            errors: true
          })

          summary = getBuildSummary(browser, info)

          console.log(messages.buildSuccess())
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
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.error(error)
    }
    if (!shouldExitOnError) {
      throw error
    }
    process.exit(1)
  }
}
