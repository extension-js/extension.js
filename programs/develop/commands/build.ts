// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import fs from 'fs'
import path from 'path'
import webpack from 'webpack'
import {merge} from 'webpack-merge'
import webpackConfig from '../webpack/webpack-config'
import {getProjectPath} from './commands-lib/get-project-path'
import * as messages from './commands-lib/messages'
import {generateZip} from './commands-lib/generate-zip'
import {loadExtensionConfig} from './commands-lib/get-extension-config'
import {DevOptions} from './dev'

export interface BuildOptions {
  mode: 'development' | 'production'
  browser?: DevOptions['browser']
  zipFilename?: string
  zip?: boolean
  zipSource?: boolean
  polyfill?: boolean
}

export async function extensionBuild(
  pathOrRemoteUrl: string | undefined,
  buildOptions?: BuildOptions
): Promise<void> {
  const projectPath = await getProjectPath(pathOrRemoteUrl)

  if (
    !pathOrRemoteUrl?.startsWith('http') &&
    !fs.existsSync(path.join(projectPath, 'manifest.json'))
  ) {
    console.log(messages.manifestNotFound())
    process.exit(1)
  }

  try {
    const browser = buildOptions.browser || 'chrome'
    const baseConfig = webpackConfig(projectPath, {
      ...buildOptions,
      browser,
      mode: 'production'
    })

    const allPluginsButBrowserRunners = baseConfig.plugins?.filter((plugin) => {
      return (
        plugin?.constructor.name !== 'plugin-browsers' &&
        plugin?.constructor.name !== 'plugin-reload'
      )
    })

    const userExtensionConfig = loadExtensionConfig(projectPath)
    const userConfig = userExtensionConfig({
      ...baseConfig,
      plugins: allPluginsButBrowserRunners
    })
    const compilerConfig = merge(userConfig)
    const compiler = webpack(compilerConfig)

    compiler.run(async (err, stats) => {
      if (err) {
        console.error(err.stack || err)
        process.exit(1)
      }

        console.log(messages.buildWebpack(projectPath, stats, browser))

        if (buildOptions?.zip || buildOptions?.zipSource) {
          await generateZip(projectPath, {...buildOptions, browser})
        }

        if (!stats?.hasErrors()) {
          console.log(messages.buildSuccess())
        } else {
          console.log(stats.toString({colors: true}))
          return reject(new Error('Build failed'))
        }

        resolve()
      })
    })
  } catch (error) {
    if (process.env.EXTENSION_ENV === 'development') {
      console.error(error)
    }
    process.exit(1)
  }
}
