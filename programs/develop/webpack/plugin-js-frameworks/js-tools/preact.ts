// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import {type Compiler, type WebpackPluginInstance} from 'webpack'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'
import {JsFramework} from '../../types'

let userMessageDelivered = false

export function isUsingPreact(projectPath: string) {
  const packageJsonPath = path.join(projectPath, 'package.json')
  const manifestJsonPath = path.join(projectPath, 'manifest.json')
  const manifest = require(manifestJsonPath)

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
      console.log(messages.isUsingTechnology(manifest, 'Preact'))

      userMessageDelivered = true
    }
  }

  return preactAsDevDep || preactAsDep
}

export async function maybeUsePreact(
  compiler: Compiler,
  projectPath: string
): Promise<JsFramework | undefined> {
  if (!isUsingPreact(projectPath)) return undefined

  try {
    require.resolve('react-refresh')
  } catch (e) {
    const reactDependencies = [
      'react-refresh',
      '@pmmmwh/react-refresh-webpack-plugin',
      'react-refresh-typescript'
    ]

    await installOptionalDependencies('Preact', reactDependencies)

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet('Preact'))
    process.exit(0)
  }

  return {
    plugins: undefined,
    loaders: undefined,
    alias: {
      react: 'preact/compat',
      'react-dom/test-utils': 'preact/test-utils',
      'react-dom': 'preact/compat', // 必须放在 test-utils 下面
      'react/jsx-runtime': 'preact/jsx-runtime'
    }
  }
}
