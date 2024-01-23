// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import fs from 'fs'
import path from 'path'
import getProjectPath from './steps/getProjectPath'
import {isUsingTypeScript} from './webpack/options/typescript'
import generateExtensionTypes from './steps/generateExtensionTypes'
import startDevServer from './webpack/startDevServer'

export interface DevOptions {
  mode?: 'development' | 'production' | 'test'
  browser?: 'chrome' | 'edge' | 'firefox' | 'all'
  port?: number
  noOpen?: boolean
  userDataDir?: string | boolean
  polyfill?: boolean
}

export default async function extensionDev(
  pathOrRemoteUrl: string | undefined,
  {...devOptions}: DevOptions
) {
  const projectPath = getProjectPath(pathOrRemoteUrl)

  // TODO: cezaraugusto maybe we don't need this
  // and can rely on the "catch" block
  if (
    !projectPath.startsWith('http') &&
    !fs.existsSync(path.join(projectPath, 'manifest.json'))
  ) {
    console.log(
      `🫣  - Manifest file not found. Path \`${projectPath}\` must include a \`manifest.json\`.`
    )
    process.exit(1)
  }

  try {
    if (isUsingTypeScript(projectPath)) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(
          '[extension-create setup] 🔷 - Using TypeScript config file: `tsconfig.json`'
        )
      }
      await generateExtensionTypes(projectPath)
    }

    await startDevServer(projectPath, {...devOptions})
  } catch (error: any) {
    console.log(`🚨 Error while developing the extension:\n\n${error || ''}`)
    process.exit(1)
  }
}
