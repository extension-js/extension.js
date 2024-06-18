// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import webpack from 'webpack'
import {bold, red} from '@colors/colors/safe'
import getProjectPath from './steps/getProjectPath'
import compilerConfig from './webpack/webpack-config'
import * as messages from './messages/startMessage'

export interface PreviewOptions {
  mode?: 'development' | 'production'
  browser?: 'chrome' | 'edge' | 'firefox' | 'all'
  port?: number
  noOpen?: boolean
  userDataDir?: string | boolean
  polyfill?: boolean
}

export default async function extensionStart(
  pathOrRemoteUrl: string | undefined,
  previewOptions: PreviewOptions = {
    mode: 'production'
  }
) {
  const projectPath = await getProjectPath(pathOrRemoteUrl)

  try {
    const browser = previewOptions.browser || 'chrome'
    const webpackConfig = compilerConfig(projectPath, {
      mode: 'production',
      browser
    })

    // BrowserPlugin can run in production but never in the build command.
    const onlyBrowserRunners = webpackConfig.plugins?.filter(
      (plugin) => plugin?.constructor.name === 'BrowserPlugin'
    )

    const webpackConfigOnlyBrowser = {
      ...webpackConfig,
      plugins: onlyBrowserRunners
    }

    messages.building(previewOptions)

    webpack(webpackConfigOnlyBrowser).run((err, stats) => {
      if (err) {
        console.error(err.stack || err)
        process.exit(1)
      }

      messages.startWebpack(projectPath, previewOptions)

      if (!stats?.hasErrors()) {
        setTimeout(() => {
          messages.ready(previewOptions)
        }, 750)
      } else {
        console.log(stats.toString({colors: true}))
        process.exit(1)
      }
    })
  } catch (error: any) {
    console.log(
      `🧩 ${bold(`Extension.js`)} ${red('✖︎✖︎✖︎')} ` +
        `Error while starting the extension:\n\n${red(
          bold((error as string) || '')
        )}`
    )
    process.exit(1)
  }
}
