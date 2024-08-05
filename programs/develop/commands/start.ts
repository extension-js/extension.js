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
import {DevOptions} from './dev'

export interface StartOptions {
  mode?: 'development' | 'production'
  browser?: DevOptions['browser']
  port?: number
  noOpen?: boolean
  userDataDir?: string | boolean
  polyfill?: boolean
}

export async function extensionStart(
  pathOrRemoteUrl: string | undefined,
  startOptions: StartOptions = {
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
    const browser = startOptions.browser || 'chrome'
    const webpackConfig = compilerConfig(projectPath, {
      mode: 'production',
      browser
    })

    console.log(messages.building(browser))

    webpack(webpackConfig).run((err, stats) => {
      if (err) {
        console.error(err.stack || err)
        process.exit(1)
      }

      if (!stats?.hasErrors()) {
        console.log(messages.runningInProduction(projectPath, startOptions))

        setTimeout(() => {
          console.log(messages.ready('production', browser))
        }, 1500)
      } else {
        console.log(stats.toString({colors: true}))
        process.exit(1)
      }
    })
  } catch (error) {
    process.exit(1)
  }
}
