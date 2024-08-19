// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'
import {JsFramework} from '../../webpack-types'
import {WebpackPluginInstance} from 'webpack'

let userMessageDelivered = false

export function isUsingPreact(projectPath: string) {
  const packageJsonPath = path.join(projectPath, 'package.json')
  const manifestJsonPath = path.join(projectPath, 'manifest.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = require(packageJsonPath)
  const preactAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.preact
  const preactAsDep =
    packageJson.dependencies && packageJson.dependencies.preact

  // This message is shown for each JS loader we have, so we only want to show it once.
  if (preactAsDevDep || preactAsDep) {
    if (!userMessageDelivered) {
      const manifest = require(manifestJsonPath)
      const manifestName = manifest.name || 'Extension.js'
      console.log(messages.isUsingIntegration(manifestName, 'Preact'))

      userMessageDelivered = true
    }
  }

  return !!preactAsDevDep || !!preactAsDep
}

export async function maybeUsePreact(
  projectPath: string
): Promise<JsFramework | undefined> {
  if (!isUsingPreact(projectPath)) return undefined

  try {
    // Fast-refresh for Preact!
    // https://github.com/preactjs/prefresh
    require.resolve('@prefresh/webpack')
  } catch (e) {
    const preactDependencies = ['@prefresh/webpack']
    const manifest = require(path.join(projectPath, 'manifest.json'))
    const manifestName = manifest.name || 'Extension.js'

    await installOptionalDependencies(
      manifestName,
      'Preact',
      preactDependencies
    )

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet(manifestName, 'Preact'))
    process.exit(0)
  }

  const preactPlugins: WebpackPluginInstance[] = [
    new (require('@prefresh/webpack'))()
  ]

  return {
    plugins: preactPlugins,
    loaders: undefined,
    alias: {
      react: 'preact/compat',
      'react-dom/test-utils': 'preact/test-utils',
      'react-dom': 'preact/compat', // 必须放在 test-utils 下面
      'react/jsx-runtime': 'preact/jsx-runtime'
    }
  }
}
