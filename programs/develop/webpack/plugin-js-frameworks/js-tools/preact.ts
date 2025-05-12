// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as path from 'path'
import * as fs from 'fs'
import PreactRefreshPlugin from '@rspack/plugin-preact-refresh'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'
import {JsFramework} from '../../webpack-types'
import {RspackPluginInstance} from '@rspack/core'

let userMessageDelivered = false

export function isUsingPreact(projectPath: string) {
  const packageJsonPath = path.join(projectPath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
  const preactAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.preact
  const preactAsDep =
    packageJson.dependencies && packageJson.dependencies.preact

  // This message is shown for each JS loader we have, so we only want to show it once.
  if (preactAsDevDep || preactAsDep) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.isUsingIntegration('Preact'))
      }

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
    await import('@rspack/plugin-preact-refresh')
  } catch (e) {
    const preactDependencies = [
      '@prefresh/core',
      '@prefresh/utils',
      '@rspack/plugin-preact-refresh',
      'preact'
    ]

    await installOptionalDependencies('Preact', preactDependencies)

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet('Preact'))
    process.exit(0)
  }

  const preactPlugins: RspackPluginInstance[] = [new PreactRefreshPlugin({})]

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
