// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import fs from 'fs'
import path from 'path'
import {getProjectPath} from './commands-lib/get-project-path'
import * as messages from './commands-lib/messages'
import {DevOptions} from './dev'
import {extensionBuild} from './build'
import {extensionPreview} from './preview'

export interface StartOptions {
  mode: 'development' | 'production'
  browser: DevOptions['browser']
  port?: number
  open?: boolean
  userDataDir?: string
  polyfill?: boolean
  chromiumBinary?: string
  geckoBinary?: string
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
    console.log(
      messages.manifestNotFoundError(path.join(projectPath, 'manifest.json'))
    )
    process.exit(1)
  }

  try {
    const browser = startOptions.browser || 'chrome'
    await extensionBuild(pathOrRemoteUrl, {
      ...startOptions,
      browser,
      silent: true
    })

    await extensionPreview(pathOrRemoteUrl, {
      ...startOptions,
      browser
    })
  } catch (error) {
    if (process.env.EXTENSION_ENV === 'development') {
      console.error(error)
    }
    process.exit(1)
  }
}
