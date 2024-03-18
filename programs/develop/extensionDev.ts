// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import fs from 'fs'
import path from 'path'
import {bold, red, yellow, underline} from '@colors/colors/safe'
import getProjectPath from './steps/getProjectPath'
import {isUsingTypeScript} from './webpack/options/typescript'
import generateExtensionTypes from './steps/generateExtensionTypes'
import startDevServer from './webpack/startDevServer'

export interface DevOptions {
  mode?: 'development' | 'production' | 'none' | undefined
  browser?: 'chrome' | 'edge' | 'firefox' | 'all'
  port?: number
  noOpen?: boolean
  userDataDir?: string | boolean
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
    console.log(
      `🧩 ${bold(`extension-create`)} ${red('✖︎✖︎✖︎')} Manifest file ${red(
        bold('not found')
      )}. Path ${underline(projectPath)} must include a ${yellow(
        'manifest.json'
      )}.`
    )
    process.exit(1)
  }

  try {
    if (isUsingTypeScript(projectPath)) {
      await generateExtensionTypes(projectPath)
    }

    await startDevServer(projectPath, {...devOptions})
  } catch (error: any) {
    console.log(
      `🧩 ${bold(`extension-create`)} ${red('✖︎✖︎✖︎')} ` +
        `Error while developing the extension:\n\n${red(
          bold((error as string) || '')
        )}`
    )
    process.exit(1)
  }
}
