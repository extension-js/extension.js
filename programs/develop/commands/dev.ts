// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import fs from 'fs'
import path from 'path'
import {devServer} from '../webpack/dev-server'
import {generateExtensionTypes} from './commands-lib/generate-extension-types'
import {isUsingTypeScript} from '../webpack/plugin-js-frameworks/js-tools/typescript'
import {getProjectPath} from './commands-lib/get-project-path'
import * as messages from './commands-lib/messages'
import {installDependencies} from './commands-lib/install-dependencies'

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
  const manifestPath = path.join(projectPath, 'manifest.json')

  if (!pathOrRemoteUrl?.startsWith('http') && !fs.existsSync(manifestPath)) {
    console.log(messages.manifestNotFoundError())
    process.exit(1)
  }

  try {
    if (isUsingTypeScript(projectPath)) {
      await generateExtensionTypes(projectPath)
    }

    // Install dependencies if they are not installed.
    const nodeModulesPath = path.join(projectPath, 'node_modules')

    if (!fs.existsSync(nodeModulesPath)) {
      const projectName = require(manifestPath).name

      console.log(messages.installingDependencies(projectName))
      await installDependencies(projectPath)
    }

    setTimeout(async () => {
      await devServer(projectPath, {
        ...devOptions,
        mode: 'development',
        browser: devOptions.browser || 'chrome'
      })
    }, 50)
  } catch (error) {
    if (process.env.EXTENSION_ENV === 'development') {
      console.error(error)
    }
    process.exit(1)
  }
}
