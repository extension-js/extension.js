// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import {bold, red} from '@colors/colors/safe'
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
  polyfill?: boolean
}

export default async function extensionStart(
  pathOrRemoteUrl: string | undefined,
  {...startOptions}: StartOptions
) {
  const projectPath = await getProjectPath(pathOrRemoteUrl)

  try {
    if (isUsingTypeScript(projectPath)) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(
          '[extension-create setup] 🔷 - Using TypeScript config file: `tsconfig.json`'
        )
      }
      await generateExtensionTypes(projectPath)
    }

    await startDevServer(projectPath, {...startOptions})
  } catch (error: any) {
    console.log(
      `🧩 ${bold(`extension-create`)} ${red('✖︎✖︎✖︎')} ` +
        `Error while developing the extension:\n\n${red(bold((error as string) || ''))}`
    )
    process.exit(1)
  }
}
