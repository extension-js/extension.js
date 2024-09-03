// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import {type RspackPluginInstance} from '@rspack/core'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'
import {JsFramework} from '../../webpack-types'

let userMessageDelivered = false

export function isUsingReact(projectPath: string) {
  const packageJsonPath = path.join(projectPath, 'package.json')
  const manifestJsonPath = path.join(projectPath, 'manifest.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = require(packageJsonPath)
  const reactAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.react
  const reactAsDep = packageJson.dependencies && packageJson.dependencies.react

  // This message is shown for each JS loader we have, so we only want to show it once.
  if (reactAsDevDep || reactAsDep) {
    if (!userMessageDelivered) {
      const manifest = require(manifestJsonPath)
      const manifestName = manifest.name || 'Extension.js'
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.isUsingIntegration(manifestName, 'React'))
      }

      userMessageDelivered = true
    }
  }

  return !!reactAsDevDep || !!reactAsDep
}

export async function maybeUseReact(
  projectPath: string
): Promise<JsFramework | undefined> {
  if (!isUsingReact(projectPath)) return undefined

  try {
    require.resolve('react-refresh')
  } catch (e) {
    const reactDependencies = ['react-refresh', '@rspack/plugin-react-refresh']

    const manifest = require(path.join(projectPath, 'manifest.json'))
    const manifestName = manifest.name || 'Extension.js'

    await installOptionalDependencies(manifestName, 'React', reactDependencies)

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet(manifestName, 'React'))
    process.exit(0)
  }

  const reactPlugins: RspackPluginInstance[] = [
    new (require('@rspack/plugin-react-refresh'))({
      overlay: false
    })
  ]

  return {
    plugins: reactPlugins,
    loaders: undefined,
    alias: undefined
  }
}
