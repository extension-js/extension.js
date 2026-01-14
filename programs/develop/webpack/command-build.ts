// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {rspack, Configuration} from '@rspack/core'
import {merge} from 'webpack-merge'
import {getProjectStructure} from './webpack-lib/project'
import * as messages from './webpack-lib/messages'
import {loadCustomWebpackConfig} from './webpack-lib/config-loader'
import {loadCommandConfig} from './webpack-lib/config-loader'
import {installDependencies} from './webpack-lib/install-dependencies'
import {assertNoManagedDependencyConflicts} from './webpack-lib/validate-user-dependencies'
import {scrubBrand} from './webpack-lib/branding'
import {
  getDirs,
  getDistPath,
  needsInstall,
  normalizeBrowser
} from './webpack-lib/paths'
import webpackConfig from './webpack-config'

import type {BuildOptions} from './webpack-types'

export type BuildSummary = {
  browser: string
  total_assets: number
  total_bytes: number
  largest_asset_bytes: number
  warnings_count: number
  errors_count: number
}

// Split out the aggregation of assets and summary to its own function
function getBuildSummary(browser: string, info: any): BuildSummary {
  const assets = info?.assets || []
  return {
    browser,
    total_assets: assets.length,
    total_bytes: assets.reduce((n: number, a: any) => n + (a.size || 0), 0),
    largest_asset_bytes: assets.reduce(
      (m: number, a: any) => Math.max(m, a.size || 0),
      0
    ),
    warnings_count: (info?.warnings || []).length,
    errors_count: (info?.errors || []).length
  }
}

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

  try {
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
          try {
            const verbose =
              String(process.env.EXTENSION_VERBOSE || '').trim() === '1'

            const str = stats.toString({
              colors: true,
              all: false,
              errors: true,
              warnings: !!verbose
            })

            if (str) console.error(scrubBrand(str))
          } catch {
            try {
              const str = stats.toString({
                colors: true,
                all: false,
                errors: true,
                warnings: true
              })

              if (str) console.error(str)
            } catch {
              // Ignore
            }
          }

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
