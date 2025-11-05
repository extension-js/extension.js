// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as path from 'path'
import {getProjectStructure} from './webpack-lib/project'
import {extensionBuild} from './build'
import {extensionPreview} from './preview'
import {StartOptions} from './types/options'
import {loadCommandConfig, loadBrowserConfig} from './webpack-lib/config-loader'

export async function extensionStart(
  pathOrRemoteUrl: string | undefined,
  startOptions: StartOptions
) {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)

  try {
    const browser = startOptions.browser || 'chrome'
    const manifestDir = path.dirname(projectStructure.manifestPath)
    const commandConfig = await loadCommandConfig(manifestDir, 'start')
    const browserConfig = await loadBrowserConfig(manifestDir, browser)

    await extensionBuild(pathOrRemoteUrl, {
      ...browserConfig,
      ...commandConfig,
      ...startOptions,
      browser,
      silent: true
    })

    const packageJsonDir = projectStructure.packageJsonPath
      ? path.dirname(projectStructure.packageJsonPath)
      : manifestDir

    await extensionPreview(pathOrRemoteUrl, {
      ...browserConfig,
      ...commandConfig,
      ...startOptions,
      browser,
      // Starts preview the extension from the build directory
      outputPath: path.join(packageJsonDir, 'dist', browser)
    })
  } catch (error) {
    if (process.env.EXTENSION_ENV === 'development') {
      console.error(error)
    }
    process.exit(1)
  }
}
