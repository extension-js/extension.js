// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {getBuildSummary, type BuildSummary} from './webpack-lib/build-summary'
import type {Configuration} from '@rspack/core'
import {createRequire} from 'module'
import {getProjectStructure} from './webpack-lib/project'
import * as messages from './webpack-lib/messages'
import {loadCustomWebpackConfig} from './webpack-lib/config-loader'
import {loadCommandConfig} from './webpack-lib/config-loader'
import {assertNoManagedDependencyConflicts} from './webpack-lib/validate-user-dependencies'
import {getDirs, getDistPath, normalizeBrowser} from './webpack-lib/paths'
import {ensureProjectReady} from './webpack-lib/dependency-manager'
import {resolveCompanionExtensionsConfig} from './feature-special-folders/folder-extensions/resolve-config'
import {getSpecialFoldersDataForProjectRoot} from './feature-special-folders/get-data'

import type {BuildOptions} from './webpack-types'

export async function extensionBuild(
  pathOrRemoteUrl: string | undefined,
  buildOptions?: BuildOptions
): Promise<BuildSummary> {
  const require = createRequire(import.meta.url)
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
    const shouldInstallProjectDeps =
      !isAuthor || buildOptions?.install !== false

    const previousOneTimeHint = process.env.EXTENSION_ONE_TIME_INSTALL_HINT
    process.env.EXTENSION_ONE_TIME_INSTALL_HINT = 'true'
    try {
      await ensureProjectReady(projectStructure, 'production', {
        skipProjectInstall:
          isVitest ||
          !projectStructure.packageJsonPath ||
          !shouldInstallProjectDeps,
        exitOnInstall: false,
        showRunAgainMessage: false
      })
    } finally {
      if (previousOneTimeHint === undefined) {
        delete process.env.EXTENSION_ONE_TIME_INSTALL_HINT
      } else {
        process.env.EXTENSION_ONE_TIME_INSTALL_HINT = previousOneTimeHint
      }
    }

    // Heavy deps are intentionally imported lazily so `preview` can run with a minimal install.
    const [{rspack}, {merge}, {handleStatsErrors}, {default: webpackConfig}] =
      await Promise.all([
        Promise.resolve(require('@rspack/core')),
        import('webpack-merge'),
        import('./webpack-lib/stats-handler'),
        import('./webpack-config')
      ])

    const debug = isAuthor
    // Guard: only error if user references managed deps in extension.config.js
    if (projectStructure.packageJsonPath) {
      assertNoManagedDependencyConflicts(
        projectStructure.packageJsonPath,
        manifestDir
      )
    }

    const commandConfig = await loadCommandConfig(manifestDir, 'build')
    const specialFoldersData =
      getSpecialFoldersDataForProjectRoot(packageJsonDir)

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

    const mergedExtensionsConfig =
      buildOptions?.extensions ??
      commandConfig.extensions ??
      specialFoldersData.extensions
    const resolvedExtensionsConfig = await resolveCompanionExtensionsConfig({
      projectRoot: packageJsonDir,
      browser,
      config: mergedExtensionsConfig
    })

    const baseConfig: Configuration = webpackConfig(projectStructure, {
      ...commandConfig,
      ...buildOptions,
      extensions: resolvedExtensionsConfig,
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
