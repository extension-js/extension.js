// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import webpack from 'webpack'
import compilerConfig from '../../webpack/webpack-config'
import * as messages from '../../webpack/lib/messages'
import {getProjectPath} from '../get-project-path'

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

    console.log(messages.previewing(previewOptions))

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
    console.log(error)
    process.exit(1)
  }
}
