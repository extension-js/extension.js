//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import {createRequire} from 'module'
import * as fs from 'fs'
import {type RspackPluginInstance} from '@rspack/core'
import colors from 'pintor'
import * as messages from '../js-frameworks-lib/messages'
import {
  installOptionalDependencies,
  hasDependency
} from '../frameworks-lib/integrations'
import {JsFramework} from '../../webpack-types'

type ReactRefreshPluginCtor = new (...args: any[]) => RspackPluginInstance

let userMessageDelivered = false
let cachedReactRefreshPlugin: ReactRefreshPluginCtor | undefined

function getReactRefreshPlugin(): ReactRefreshPluginCtor | undefined {
  if (cachedReactRefreshPlugin) return cachedReactRefreshPlugin

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@rspack/plugin-react-refresh')
    const plugin = (mod && (mod as any).default) || (mod as any)
    cachedReactRefreshPlugin = plugin as ReactRefreshPluginCtor

    return cachedReactRefreshPlugin
  } catch {
    // If the plugin isn't installed or the export shape changed,
    // we fall through and let maybeUseReact handle error signalling.
  }

  return undefined
}

export function isUsingReact(projectPath: string) {
  if (hasDependency(projectPath, 'react')) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          `${colors.brightMagenta('►►► Author says')} ${messages.isUsingIntegration('React')}`
        )
      }

      userMessageDelivered = true
    }
    return true
  }

  return false
}

export async function maybeUseReact(
  projectPath: string
): Promise<JsFramework | undefined> {
  if (!isUsingReact(projectPath)) return undefined

  try {
    require.resolve('react-refresh')
  } catch (e) {
    const reactDependencies = ['react-refresh', '@rspack/plugin-react-refresh']

    const didInstall = await installOptionalDependencies(
      'React',
      reactDependencies
    )

    if (!didInstall) {
      throw new Error('[React] Optional dependencies failed to install.')
    }

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet('React'))
    process.exit(0)
  }

  const ReactRefreshPlugin = getReactRefreshPlugin()

  if (!ReactRefreshPlugin) {
    throw new Error(
      '[React] @rspack/plugin-react-refresh is installed but its plugin could not be resolved.'
    )
  }

  const reactPlugins: RspackPluginInstance[] = [
    new ReactRefreshPlugin({
      overlay: false
    }) as any // TODO: cezaraugusto fix this
  ]

  // Ensure a single React/renderer instance is bundled to avoid invalid hook calls
  const requireFromProject = createRequire(
    path.join(projectPath, 'package.json')
  )
  let reactPath: string | undefined
  let reactDomPath: string | undefined
  let reactDomClientPath: string | undefined
  let jsxRuntimePath: string | undefined
  try {
    reactPath = requireFromProject.resolve('react')
  } catch {
    // Do nothing
  }
  try {
    reactDomPath = requireFromProject.resolve('react-dom')
  } catch {
    // Do nothing
  }
  try {
    reactDomClientPath = requireFromProject.resolve('react-dom/client')
  } catch {
    // Do nothing
  }
  try {
    jsxRuntimePath = requireFromProject.resolve('react/jsx-runtime')
  } catch {
    // Do nothing
  }

  const alias: Record<string, string> = {}
  if (reactPath) alias['react$'] = reactPath
  if (reactDomPath) alias['react-dom$'] = reactDomPath
  if (reactDomClientPath) alias['react-dom/client'] = reactDomClientPath
  if (jsxRuntimePath) alias['react/jsx-runtime'] = jsxRuntimePath

  return {
    plugins: reactPlugins,
    loaders: undefined,
    alias
  }
}
