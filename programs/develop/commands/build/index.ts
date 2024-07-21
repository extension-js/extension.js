// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import {bold, red} from '@colors/colors/safe'
import webpack from 'webpack'
import compilerConfig from '../../webpack/webpack-config'
import {getProjectPath} from '../../webpack/lib/get-project-path'
import * as messages from '../../webpack/lib/messages'
import {getOutputPath} from '../../webpack/config/getPath'
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

    // BrowserPlugin can run in production but never in the build command.
    // TODO: cezaraugusto this is fragile
    const allPluginsButBrowserRunners = webpackConfig.plugins?.filter(
      (plugin) => plugin?.constructor.name !== 'BrowserPlugin'
    )

    const webpackConfigNoBrowser = {
      ...webpackConfig,
      plugins: allPluginsButBrowserRunners
    }

    webpack(webpackConfigNoBrowser).run((err, stats) => {
      if (err) {
        console.error(err.stack || err)
        process.exit(1)
      }

      const outputPath =
        webpackConfigNoBrowser.output?.path ||
        getOutputPath(projectPath, browser)

      console.log(
        messages.buildWebpack(projectPath, stats, outputPath, browser)
      )

      if (buildOptions.zip || buildOptions.zipSource) {
        generateZip(projectPath, {...buildOptions, browser})
      }

      if (!stats?.hasErrors()) {
        console.log(messages.ready(buildOptions))
      } else {
        console.log(stats.toString({colors: true}))
        process.exit(1)
      }
    })
  } catch (error: any) {
    console.log(messages.errorWhileBuilding(error))
    process.exit(1)
  }
}
