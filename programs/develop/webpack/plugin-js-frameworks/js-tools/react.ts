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
  hasDependency,
  resolveDevelopInstallRoot
} from '../frameworks-lib/integrations'
import {JsFramework} from '../../webpack-types'

type ReactRefreshPluginCtor = new (...args: any[]) => RspackPluginInstance

let userMessageDelivered = false

function resolveWithRuntimePaths(
  id: string,
  projectPath: string
): string | undefined {
  const extensionRoot = resolveDevelopInstallRoot()
  const paths = [projectPath, extensionRoot || undefined, process.cwd()].filter(
    Boolean
  ) as string[]
  try {
    return require.resolve(id, {paths})
  } catch {
    return undefined
  }
}

function getReactRefreshPlugin(
  projectPath: string
): ReactRefreshPluginCtor | undefined {
  const extensionRoot = resolveDevelopInstallRoot()
  const bases = [projectPath, extensionRoot || undefined, process.cwd()].filter(
    Boolean
  ) as string[]

  for (const base of bases) {
    try {
      const req = createRequire(path.join(base, 'package.json'))
      const mod = req('@rspack/plugin-react-refresh')
      const plugin = (mod && (mod as any).default) || (mod as any)
      if (plugin) return plugin as ReactRefreshPluginCtor
    } catch {
      // Try next base
    }
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

  let reactRefreshPath = resolveWithRuntimePaths('react-refresh', projectPath)

  if (!reactRefreshPath) {
    const reactDependencies = ['react-refresh', '@rspack/plugin-react-refresh']

    const didInstall = await installOptionalDependencies(
      'React',
      reactDependencies
    )

    if (!didInstall) {
      throw new Error('[React] Optional dependencies failed to install.')
    }

    reactRefreshPath = resolveWithRuntimePaths('react-refresh', projectPath)
    if (!reactRefreshPath) {
      throw new Error(
        '[React] react-refresh could not be resolved after optional dependency installation.'
      )
    }
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(messages.youAreAllSet('React'))
    }
  }

  const ReactRefreshPlugin = getReactRefreshPlugin(projectPath)

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
  let jsxDevRuntimePath: string | undefined
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
  try {
    jsxDevRuntimePath = requireFromProject.resolve('react/jsx-dev-runtime')
  } catch {
    // Do nothing
  }

  const alias: Record<string, string> = {}
  if (reactPath) alias['react$'] = reactPath
  if (reactDomPath) alias['react-dom$'] = reactDomPath
  if (reactDomClientPath) alias['react-dom/client'] = reactDomClientPath
  if (jsxRuntimePath) alias['react/jsx-runtime'] = jsxRuntimePath
  if (jsxDevRuntimePath) alias['react/jsx-dev-runtime'] = jsxDevRuntimePath

  return {
    plugins: reactPlugins,
    loaders: undefined,
    alias
  }
}
