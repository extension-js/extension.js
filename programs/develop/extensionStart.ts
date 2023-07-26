// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import getProjectPath from './steps/getProjectPath'
import {isUsingTypeScript} from './webpack/options/typescript'
import generateExtensionTypes from './steps/generateExtensionTypes'
import startDevServer from './webpack/startDevServer'

export interface StartOptions {
  mode?: 'development' | 'production'
  browser?: 'chrome' | 'edge' | 'firefox' | 'all'
  port?: number
  noOpen?: boolean
  userDataDir?: string | boolean
  noPolyfill?: boolean
}

export default async function extensionStart(
  pathOrRemoteUrl: string | undefined,
  {...startOptions}: StartOptions
) {
  const projectPath = getProjectPath(pathOrRemoteUrl)

  try {
    if (isUsingTypeScript(projectPath)) {
      console.log('🔷 - Using TypeScript config file: `tsconfig.json`')
      await generateExtensionTypes(projectPath)
    }

    await startDevServer(projectPath, {...startOptions})
  } catch (error) {
    console.log(
      `🚨 Error while developing the extension:\n${JSON.stringify(error) || ''}`
    )
    process.exit(1)
  }
}
