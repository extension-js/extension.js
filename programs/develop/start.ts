// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as fs from 'fs'
import * as path from 'path'
import {getProjectStructure} from './develop-lib/get-project-path'
import * as messages from './develop-lib/messages'
import {extensionBuild} from './build'
import {extensionPreview} from './preview'
import {StartOptions} from './types/options'

export async function extensionStart(
  pathOrRemoteUrl: string | undefined,
  startOptions: StartOptions
) {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)

  try {
    const browser = startOptions.browser || 'chrome'
    await extensionBuild(pathOrRemoteUrl, {
      ...startOptions,
      browser,
      silent: true
    })

    const manifestDir = path.dirname(projectStructure.manifestPath)

    await extensionPreview(pathOrRemoteUrl, {
      ...startOptions,
      browser,
      // Starts preview the extension from the build directory
      outputPath: path.join(manifestDir, 'dist', browser)
    })
  } catch (error) {
    if (process.env.EXTENSION_ENV === 'development') {
      console.error(error)
    }
    process.exit(1)
  }
}
