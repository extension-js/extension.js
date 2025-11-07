// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as path from 'path'
import * as fs from 'fs'
import PreactRefreshPlugin from '@rspack/plugin-preact-refresh'
import * as messages from '../js-frameworks-lib/messages'
import {
  installOptionalDependencies,
  hasDependency
} from '../frameworks-lib/integrations'
import {JsFramework} from '../../webpack-types'
import {RspackPluginInstance} from '@rspack/core'

let userMessageDelivered = false

export function isUsingPreact(projectPath: string) {
  if (hasDependency(projectPath, 'preact')) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.isUsingIntegration('Preact'))
      }

      userMessageDelivered = true
    }
    return true
  }

  return false
}

export async function maybeUsePreact(
  projectPath: string
): Promise<JsFramework | undefined> {
  if (!isUsingPreact(projectPath)) return undefined

  try {
    // Fast-refresh for Preact!
    // https://github.com/preactjs/prefresh
    require.resolve('@rspack/plugin-preact-refresh')
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

  const preactPlugins: RspackPluginInstance[] = [
    new PreactRefreshPlugin({}) as any // TODO: cezaraugusto fix this
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
