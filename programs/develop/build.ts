// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as fs from 'fs'
import * as path from 'path'
import {rspack, Configuration} from '@rspack/core'
import {merge} from 'webpack-merge'
import webpackConfig from './webpack/webpack-config'
import {getProjectStructure} from './develop-lib/get-project-path'
import * as messages from './develop-lib/messages'
import {generateZip} from './develop-lib/generate-zip'
import {loadCustomWebpackConfig} from './develop-lib/get-extension-config'
import {BuildOptions} from './develop-lib/config-types'
import {installDependencies} from './develop-lib/install-dependencies'
import {assertNoManagedDependencyConflicts} from './develop-lib/validate-user-dependencies'

export async function extensionBuild(
  pathOrRemoteUrl: string | undefined,
  buildOptions?: BuildOptions
): Promise<void> {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)

  try {
    const browser = buildOptions?.browser || 'chrome'
    const manifestDir = path.dirname(projectStructure.manifestPath)
    const packageJsonDir = projectStructure.packageJsonPath
      ? path.dirname(projectStructure.packageJsonPath)
      : manifestDir

    // Guard: only error if user references managed deps in extension.config.js
    if (projectStructure.packageJsonPath) {
      assertNoManagedDependencyConflicts(
        projectStructure.packageJsonPath,
        path.dirname(projectStructure.manifestPath)
      )
    }

    const baseConfig: Configuration = webpackConfig(projectStructure, {
      ...buildOptions,
      browser,
      mode: 'production',
      output: {
        clean: true,
        path: path.join(manifestDir, 'dist', browser)
      }
    })

    const allPluginsButBrowserRunners = baseConfig.plugins?.filter((plugin) => {
      const ctorName = (plugin as any)?.constructor?.name
      return (
        plugin?.constructor.name !== 'plugin-browsers' &&
        plugin?.constructor.name !== 'plugin-reload'
      )
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
      const nodeModulesPath = path.join(packageJsonDir, 'node_modules')
      if (!fs.existsSync(nodeModulesPath)) {
        console.log(messages.installingDependencies())

        // Prevents `process.chdir() is not supported in workers` error
        if (process.env.VITEST !== 'true') {
          await installDependencies(packageJsonDir)
        }
      }
    }

    await new Promise<void>((resolve, reject) => {
      compiler.run(async (err, stats) => {
        if (err) {
          console.error(err.stack || err)
          return reject(err)
        }

        if (!buildOptions?.silent) {
          console.log(messages.buildWebpack(manifestDir, stats, browser))
        }

        if (buildOptions?.zip || buildOptions?.zipSource) {
          await generateZip(manifestDir, {
            ...buildOptions,
            browser
          })
        }

        if (!stats?.hasErrors()) {
          console.log(messages.buildSuccess())
          resolve()
        } else {
          // Print stats and reject to let callers (tests/CLI) decide on process exit
          console.log(stats.toString({colors: true}))
          if (buildOptions?.exitOnError === false) {
            return reject(new Error('Build failed with errors'))
          }
          process.exit(1)
        }
      })
    })
  } catch (error) {
    if (process.env.EXTENSION_ENV === 'development') {
      console.error(error)
    }
    if (buildOptions?.exitOnError === false) {
      throw error
    }
    process.exit(1)
  }
}
