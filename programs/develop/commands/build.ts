// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import fs from 'fs'
import path from 'path'
import {rspack, Configuration} from '@rspack/core'
import {merge} from 'webpack-merge'
import webpackConfig from '../webpack/webpack-config'
import {getProjectPath} from './commands-lib/get-project-path'
import * as messages from './commands-lib/messages'
import {generateZip} from './commands-lib/generate-zip'
import {loadCustomWebpackConfig} from './commands-lib/get-extension-config'
import {BuildOptions} from './commands-lib/config-types'

export async function extensionBuild(
  pathOrRemoteUrl: string | undefined,
  buildOptions?: BuildOptions
): Promise<void> {
  const projectPath = await getProjectPath(pathOrRemoteUrl)

  if (
    !pathOrRemoteUrl?.startsWith('http') &&
    !fs.existsSync(path.join(projectPath, 'manifest.json'))
  ) {
    console.log(
      messages.manifestNotFoundError(path.join(projectPath, 'manifest.json'))
    )
    process.exit(1)
  }

  try {
    const browser = buildOptions?.browser || 'chrome'
    const baseConfig: Configuration = webpackConfig(projectPath, {
      ...buildOptions,
      browser,
      mode: 'production',
      output: {
        clean: true
      }
    })

    const allPluginsButBrowserRunners = baseConfig.plugins?.filter((plugin) => {
      return (
        plugin?.constructor.name !== 'plugin-browsers' &&
        plugin?.constructor.name !== 'plugin-reload'
      )
    })

    const userExtensionConfig = await loadCustomWebpackConfig(projectPath)
    const userConfig = userExtensionConfig({
      ...baseConfig,
      plugins: allPluginsButBrowserRunners
    })

    const compilerConfig = merge(userConfig)
    const compiler = rspack(compilerConfig)

    await new Promise<void>((resolve, reject) => {
      compiler.run(async (err, stats) => {
        if (err) {
          console.error(err.stack || err)
          return reject(err)
        }

        if (!buildOptions?.silent) {
          console.log(messages.buildWebpack(projectPath, stats, browser))
        }

        if (buildOptions?.zip || buildOptions?.zipSource) {
          await generateZip(projectPath, {...buildOptions, browser})
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
