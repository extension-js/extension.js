// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as fs from 'fs'
import * as path from 'path'
import {devServer} from './webpack/dev-server'
import {generateExtensionTypes} from './develop-lib/generate-extension-types'
import {isUsingTypeScript} from './webpack/plugin-js-frameworks/js-tools/typescript'
import {getProjectStructure} from './develop-lib/get-project-path'
import * as messages from './develop-lib/messages'
import {installDependencies} from './develop-lib/install-dependencies'
import {assertNoManagedDependencyConflicts} from './develop-lib/validate-user-dependencies'
import {DevOptions} from './develop-lib/config-types'

export async function extensionDev(
  pathOrRemoteUrl: string | undefined,
  devOptions: DevOptions
) {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)

  try {
    const manifestDir = path.dirname(projectStructure.manifestPath)
    const packageJsonDir = projectStructure.packageJsonPath
      ? path.dirname(projectStructure.packageJsonPath)
      : manifestDir

    if (isUsingTypeScript(manifestDir)) {
      await generateExtensionTypes(manifestDir)
    }

    // Guard: only error if user references managed deps in extension.config.js
    if (projectStructure.packageJsonPath) {
      assertNoManagedDependencyConflicts(
        projectStructure.packageJsonPath,
        path.dirname(projectStructure.manifestPath)
      )
    }

    // Install dependencies if they are not installed (skip in web-only mode).
    if (projectStructure.packageJsonPath) {
      // Install if node_modules is missing or empty
      const nodeModulesPath = path.join(packageJsonDir, 'node_modules')
      const needsInstall =
        !fs.existsSync(nodeModulesPath) ||
        (fs.existsSync(nodeModulesPath) &&
          fs.readdirSync(nodeModulesPath).length === 0)

      if (needsInstall) {
        console.log(messages.installingDependencies())
        await installDependencies(packageJsonDir)
      }
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
