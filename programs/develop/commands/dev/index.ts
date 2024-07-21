// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import fs from 'fs'
import path from 'path'
import {bold, red, yellow, underline} from '@colors/colors/safe'
import {devServer} from '../../webpack/dev-server'
import {isUsingTypeScript} from '../../webpack/options/typescript'
import {getProjectPath} from '../../webpack/lib/get-project-path'
import * as messages from '../../webpack/lib/messages'
import generateExtensionTypes from './generate-extension-types'

export interface DevOptions {
  mode?: 'development' | 'production' | 'none' | undefined
  browser?: 'chrome' | 'edge' | 'firefox' | 'all'
  port?: number
  noOpen?: boolean
  userDataDir?: string
  polyfill?: boolean
}

export default async function extensionDev(
  pathOrRemoteUrl: string | undefined,
  {...devOptions}: DevOptions = {mode: 'development'}
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

    await devServer(projectPath, {...devOptions})
  } catch (error: any) {
    console.log(messages.errorWhileStarting(error))
    process.exit(1)
  }
}
