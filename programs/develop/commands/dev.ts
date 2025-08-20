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
import {assertNoManagedDependencyConflicts} from './commands-lib/validate-user-dependencies'
import {DevOptions} from './commands-lib/config-types'

export async function extensionDev(
  pathOrRemoteUrl: string | undefined,
  devOptions: DevOptions
) {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)

  try {
    const manifestDir = path.dirname(projectStructure.manifestPath)
    const packageJsonDir = path.dirname(projectStructure.packageJsonPath)

    if (isUsingTypeScript(manifestDir)) {
      await generateExtensionTypes(manifestDir)
    }

    // Guard: only error if user references managed deps in extension.config.js
    assertNoManagedDependencyConflicts(
      projectStructure.packageJsonPath,
      path.dirname(projectStructure.manifestPath)
    )

    // Install dependencies if they are not installed.
    const nodeModulesPath = path.join(packageJsonDir, 'node_modules')

    if (!fs.existsSync(nodeModulesPath)) {
      console.log(messages.installingDependencies())
      await installDependencies(packageJsonDir)
    }

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
