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
import {loadExtensionConfig} from './commands-lib/get-extension-config'
import {DevOptions} from './dev'

export interface StartOptions {
  mode: 'development' | 'production'
  browser: DevOptions['browser']
  port?: number
  noOpen?: boolean
  userDataDir?: string
  polyfill?: boolean
}

export async function extensionStart(
  pathOrRemoteUrl: string | undefined,
  startOptions: StartOptions
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
    const baseConfig = webpackConfig(projectPath, {
      ...startOptions,
      browser,
      mode: 'production'
    })

    const allPluginsButReloader = baseConfig.plugins?.filter((plugin) => {
      return plugin?.constructor.name !== 'plugin-reload'
    })

    console.log(messages.building(browser))

    const userExtensionConfig = loadExtensionConfig(projectPath)
    const userConfig = userExtensionConfig({
      ...baseConfig,
      plugins: allPluginsButReloader
    })
    const compilerConfig = merge(userConfig)
    const compiler = webpack(compilerConfig)

    compiler.run((err, stats) => {
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
    if (process.env.EXTENSION_ENV === 'development') {
      console.error(error)
    }
    process.exit(1)
  }
}
