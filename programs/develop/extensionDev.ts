// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import fs from 'fs'
import path from 'path'
import {bold, red} from '@colors/colors/safe'
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
  const projectPath = await getProjectPath(pathOrRemoteUrl)

  if (
    !pathOrRemoteUrl?.startsWith('http') &&
    !fs.existsSync(path.join(projectPath, 'manifest.json'))
  ) {
    console.log(
      `🫣  - Manifest file not found.\nPath \`${projectPath}\` must include a \`manifest.json\`.`
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
    console.log(
      `🧩 ${bold(`extension-create`)} ${red('✖︎✖︎✖︎')} ` +
        `Error while developing the extension:\n\n${red(bold(error.toString() || ''))}`
    )
    process.exit(1)
  }
}
