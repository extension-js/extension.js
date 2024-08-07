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
import * as messages from './commands-lib/messages'
import {getProjectPath} from './commands-lib/get-project-path'
import {DevOptions} from './dev'

export interface PreviewOptions {
  mode?: 'development' | 'production'
  browser?: DevOptions['browser']
  port?: number
  noOpen?: boolean
  userDataDir?: string | boolean
  polyfill?: boolean
}

export async function extensionPreview(
  pathOrRemoteUrl: string | undefined,
  previewOptions: PreviewOptions = {
    mode: 'production'
  }
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
    const browser = previewOptions.browser || 'chrome'
    const webpackConfig = compilerConfig(projectPath, {
      mode: 'production',
      browser
    })

    const onlyBrowserRunners = webpackConfig.plugins?.filter(
      (plugin) => plugin?.constructor.name === 'plugin-browsers'
    )

    const webpackConfigOnlyBrowser = {
      ...webpackConfig,
      plugins: onlyBrowserRunners
    }

    console.log(messages.previewing(browser))

    webpack(webpackConfigOnlyBrowser).run((err, stats) => {
      if (err) {
        console.error(err.stack || err)
        process.exit(1)
      }

      console.log(messages.previewWebpack())

      if (!stats?.hasErrors()) {
        setTimeout(() => {
          console.log(messages.ready('production', browser))
        }, 750)
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
