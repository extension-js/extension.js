// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as path from 'path'
import {createRequire} from 'module'
import * as fs from 'fs'
import {type RspackPluginInstance} from '@rspack/core'
import ReactRefreshPlugin from '@rspack/plugin-react-refresh'
import * as messages from '../../webpack-lib/messages'
import {installOptionalDependencies} from '../../webpack-lib/utils'
import {hasDependency} from '../../webpack-lib/utils'
import {JsFramework} from '../../webpack-types'

let userMessageDelivered = false

export function isUsingReact(projectPath: string) {
  if (hasDependency(projectPath, 'react')) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.isUsingIntegration('React'))
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

    await installOptionalDependencies('React', reactDependencies)

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet('React'))
    process.exit(0)
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
  } catch {}
  try {
    reactDomPath = requireFromProject.resolve('react-dom')
  } catch {}
  try {
    reactDomClientPath = requireFromProject.resolve('react-dom/client')
  } catch {}
  try {
    jsxRuntimePath = requireFromProject.resolve('react/jsx-runtime')
  } catch {}

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
