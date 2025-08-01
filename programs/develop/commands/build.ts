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
import webpackConfig from '../webpack/webpack-config'
import {getProjectStructure} from './commands-lib/get-project-path'
import * as messages from './commands-lib/messages'
import {generateZip} from './commands-lib/generate-zip'
import {loadCustomWebpackConfig} from './commands-lib/get-extension-config'
import {BuildOptions} from './commands-lib/config-types'
import {installDependencies} from './commands-lib/install-dependencies'

export async function extensionBuild(
  pathOrRemoteUrl: string | undefined,
  buildOptions?: BuildOptions
): Promise<void> {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)

  try {
    const browser = buildOptions?.browser || 'chrome'
    const manifestDir = path.dirname(projectStructure.manifestPath)

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

    // Install dependencies if they are not installed.
    const packageJsonDir = path.dirname(projectStructure.packageJsonPath)
    const nodeModulesPath = path.join(packageJsonDir, 'node_modules')

    if (!fs.existsSync(nodeModulesPath)) {
      console.log(messages.installingDependencies())

      // Prevents `process.chdir() is not supported in workers` error
      if (process.env.VITEST !== 'true') {
        await installDependencies(packageJsonDir)
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
          console.log(stats.toString({colors: true}))
          process.exit(1)
        }
      })
    })
  } catch (error) {
    if (process.env.EXTENSION_ENV === 'development') {
      console.error(error)
    }
    process.exit(1)
  }
}
