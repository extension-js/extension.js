// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as fs from 'fs'
import * as path from 'path'
import {devServer} from '../webpack/dev-server'
import {generateExtensionTypes} from './commands-lib/generate-extension-types'
import {isUsingTypeScript} from '../webpack/plugin-js-frameworks/js-tools/typescript'
import {getProjectStructure} from './commands-lib/get-project-path'
import * as messages from './commands-lib/messages'
import {installDependencies} from './commands-lib/install-dependencies'
import {DevOptions} from './commands-lib/config-types'

export async function extensionDev(
  pathOrRemoteUrl: string | undefined,
  devOptions: DevOptions
) {
  console.log('🔍 [extensionDev] called with:', {pathOrRemoteUrl, devOptions})
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)
  console.log('🔍 [extensionDev] projectStructure:', projectStructure)

  try {
    const manifestDir = path.dirname(projectStructure.manifestPath)
    const packageJsonDir = path.dirname(projectStructure.packageJsonPath)

    if (isUsingTypeScript(manifestDir)) {
      await generateExtensionTypes(manifestDir)
    }

    // Install dependencies if they are not installed.
    const nodeModulesPath = path.join(packageJsonDir, 'node_modules')

    if (!fs.existsSync(nodeModulesPath)) {
      console.log(messages.installingDependencies())
      await installDependencies(packageJsonDir)
    }

    console.log('🔍 [extensionDev] calling devServer with:', {
      projectStructure,
      devOptions: {
        ...devOptions,
        mode: 'development',
        browser: devOptions.browser || 'chrome'
      }
    })
    await devServer(projectStructure, {
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
