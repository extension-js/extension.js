// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import fs from 'fs'
import path from 'path'
import webpack from 'webpack'
import compilerConfig from '../webpack/webpack-config'
import {getProjectPath} from './commands-lib/get-project-path'
import * as messages from './commands-lib/messages'
import {generateZip} from './commands-lib/generate-zip'
import {DevOptions} from './dev'

export interface BuildOptions {
  browser?: DevOptions['browser']
  zipFilename?: string
  zip?: boolean
  zipSource?: boolean
  polyfill?: boolean
}

export async function extensionBuild(
  pathOrRemoteUrl: string | undefined,
  buildOptions: BuildOptions
) {
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
    const webpackConfig = compilerConfig(projectPath, {
      mode: 'production',
      browser
    })

    const allPluginsButBrowserRunners = webpackConfig.plugins?.filter(
      (plugin) => {
        return (
          plugin?.constructor.name !== 'plugin-browsers' &&
          plugin?.constructor.name !== 'plugin-reload'
        )
      }
    )

    const webpackConfigNoBrowser = {
      ...webpackConfig,
      plugins: allPluginsButBrowserRunners
    }

    webpack(webpackConfigNoBrowser).run(async (err, stats) => {
      if (err) {
        console.error(err.stack || err)
        process.exit(1)
      }

      console.log(messages.buildWebpack(projectPath, stats, browser))

      if (buildOptions.zip || buildOptions.zipSource) {
        await generateZip(projectPath, {...buildOptions, browser})
      }

      if (!stats?.hasErrors()) {
        console.log(messages.buildSuccess())
      } else {
        console.log(stats.toString({colors: true}))
        process.exit(1)
      }
    })
  } catch (error) {
    if (process.env.EXTENSION_ENV === 'development') {
      console.error(error)
    }
    process.exit(1)
  }
}
