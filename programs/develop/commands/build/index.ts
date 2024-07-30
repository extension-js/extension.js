// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import webpack from 'webpack'
import compilerConfig from '../../webpack/webpack-config'
import {getProjectPath} from '../get-project-path'
import * as messages from '../../webpack/lib/messages'
import {generateZip} from './generate-zip'

export interface BuildOptions {
  browser?: 'chrome' | 'edge' | 'firefox' | 'all'
  zipFilename?: string
  zip?: boolean
  zipSource?: boolean
  polyfill?: boolean
}

export default async function extensionBuild(
  pathOrRemoteUrl: string | undefined,
  buildOptions: BuildOptions
) {
  const projectPath = await getProjectPath(pathOrRemoteUrl)

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

      const outputPath =
        webpackConfigNoBrowser.output?.path ||
        path.join(projectPath, 'dist', browser)

      console.log(
        messages.buildWebpack(projectPath, stats, outputPath, browser)
      )

      if (buildOptions.zip || buildOptions.zipSource) {
        await generateZip(projectPath, {...buildOptions, browser})
      }

      if (!stats?.hasErrors()) {
        console.log(messages.ready(browser))
      } else {
        console.log(stats.toString({colors: true}))
        process.exit(1)
      }
    })
  } catch (error) {
    // console.log(error)
    process.exit(1)
  }
}
