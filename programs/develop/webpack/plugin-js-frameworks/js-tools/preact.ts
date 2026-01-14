//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import colors from 'pintor'
import * as messages from '../js-frameworks-lib/messages'
import {
  installOptionalDependencies,
  hasDependency
} from '../frameworks-lib/integrations'
import {JsFramework} from '../../webpack-types'
import {RspackPluginInstance} from '@rspack/core'

type PreactRefreshPluginCtor = new (...args: any[]) => RspackPluginInstance

let userMessageDelivered = false
let cachedPreactRefreshPlugin: PreactRefreshPluginCtor | undefined

function getPreactRefreshPlugin(): PreactRefreshPluginCtor | undefined {
  if (cachedPreactRefreshPlugin) return cachedPreactRefreshPlugin

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@rspack/plugin-preact-refresh')
    const plugin = (mod && (mod as any).default) || (mod as any)
    cachedPreactRefreshPlugin = plugin as PreactRefreshPluginCtor

    return cachedPreactRefreshPlugin
  } catch {
    // If the plugin isn't installed or the export shape changed,
    // we fall through and let maybeUsePreact handle error signalling.
  }
  return undefined
}

export function isUsingPreact(projectPath: string) {
  if (hasDependency(projectPath, 'preact')) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          `${colors.brightMagenta('►►► Author says')} ${messages.isUsingIntegration('Preact')}`
        )
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

  const PreactRefreshPlugin = getPreactRefreshPlugin()

  if (!PreactRefreshPlugin) {
    throw new Error(
      '[Preact] @rspack/plugin-preact-refresh is installed but its plugin could not be resolved.'
    )
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
