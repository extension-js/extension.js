// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import fs from 'fs'
import path from 'path'
import {devServer} from '../webpack/dev-server'
import generateExtensionTypes from './commands-lib/generate-extension-types'
import {isUsingTypeScript} from '../webpack/plugin-js-frameworks/js-tools/typescript'
import {getProjectPath} from './commands-lib/get-project-path'
import * as messages from './commands-lib/messages'

export interface DevOptions {
  browser: 'chrome' | 'edge' | 'firefox'
  mode: 'development' | 'production' | 'none' | undefined
  port?: number
  noOpen?: boolean
  userDataDir?: string
  profile?: string
  preferences?: Record<string, any>
  browserFlags?: string[]
  startingUrl?: string
  polyfill?: boolean
}

export async function extensionDev(
  pathOrRemoteUrl: string | undefined,
  devOptions: DevOptions
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
    if (isUsingTypeScript(projectPath)) {
      await generateExtensionTypes(projectPath)
    }

    await devServer(projectPath, {
      ...devOptions,
      mode: 'development',
      browser: devOptions.browser || 'chrome'
    })
  } catch (error) {
    if (process.env.EXTENSION_ENV === 'development') {
      console.error(error)
    }
    process.exit(1)
  }
}
