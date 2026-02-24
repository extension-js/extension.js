//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import {createRequire} from 'module'
import {type RspackPluginInstance} from '@rspack/core'
import colors from 'pintor'
import * as messages from '../js-frameworks-lib/messages'
import {hasDependency} from '../frameworks-lib/integrations'
import {JsFramework} from '../../webpack-types'
import {
  ensureOptionalModuleLoaded,
  ensureOptionalPackageResolved
} from '../../webpack-lib/optional-deps-resolver'

type ReactRefreshPluginCtor = new (...args: any[]) => RspackPluginInstance

let userMessageDelivered = false

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

  const reactDependencies = ['react-refresh', '@rspack/plugin-react-refresh']
  await ensureOptionalPackageResolved({
    integration: 'React',
    projectPath,
    dependencyId: 'react-refresh',
    installDependencies: reactDependencies,
    verifyPackageIds: reactDependencies
  })

  const ReactRefreshPlugin =
    await ensureOptionalModuleLoaded<ReactRefreshPluginCtor>({
      integration: 'React',
      projectPath,
      dependencyId: '@rspack/plugin-react-refresh',
      installDependencies: reactDependencies,
      verifyPackageIds: reactDependencies,
      moduleAdapter: (mod: any) =>
        ((mod && mod.default) || mod) as ReactRefreshPluginCtor
    })

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
