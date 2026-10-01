//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import type {RspackPluginInstance} from '@rspack/core'
import colors from 'pintor'
import {isDebug, prefix} from '../../lib/messaging'
import {
  loadOptionalContractModuleWithoutInstall,
  resolveOptionalContractPackageWithoutInstall
} from '../../lib/optional-deps-resolver'
import type {JsFramework} from '../../types'
import {hasDependency} from '../frameworks-lib/integrations'
import * as messages from '../js-frameworks-lib/messages'

type ReactRefreshPluginCtor = new (...args: unknown[]) => RspackPluginInstance

let userMessageDelivered = false

type MaybeUseReactOptions = {
  refreshExclude?: unknown
  disableRefresh?: boolean
}

export function isUsingReact(projectPath: string) {
  if (hasDependency(projectPath, 'react')) {
    if (!userMessageDelivered) {
      if (isDebug()) {
        console.log(
          `${prefix('debug')} ${messages.isUsingIntegration('React')}`
        )
      }

      userMessageDelivered = true
    }

    return true
  }

  return false
}

export async function maybeUseReact(
  projectPath: string,
  options: MaybeUseReactOptions = {}
): Promise<JsFramework | undefined> {
  if (!isUsingReact(projectPath)) return undefined

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
    // Ignore
  }

  try {
    reactDomPath = requireFromProject.resolve('react-dom')
  } catch {
    // Ignore
  }

  try {
    reactDomClientPath = requireFromProject.resolve('react-dom/client')
  } catch {
    // Ignore
  }

  try {
    jsxRuntimePath = requireFromProject.resolve('react/jsx-runtime')
  } catch {
    // Ignore
  }

  try {
    jsxDevRuntimePath = requireFromProject.resolve('react/jsx-dev-runtime')
  } catch {
    // Ignore
  }

  const alias: Record<string, string> = {}
  if (reactPath) alias.react$ = reactPath
  if (reactDomPath) alias['react-dom$'] = reactDomPath
  if (reactDomClientPath) alias['react-dom/client'] = reactDomClientPath
  if (jsxRuntimePath) alias['react/jsx-runtime'] = jsxRuntimePath
  if (jsxDevRuntimePath) alias['react/jsx-dev-runtime'] = jsxDevRuntimePath

  if (options.disableRefresh === true) {
    return {
      plugins: [],
      loaders: undefined,
      alias
    }
  }

  resolveOptionalContractPackageWithoutInstall({
    contractId: 'react-refresh',
    projectPath,
    dependencyId: 'react-refresh'
  })

  const ReactRefreshPlugin =
    loadOptionalContractModuleWithoutInstall<ReactRefreshPluginCtor>({
      contractId: 'react-refresh',
      projectPath,
      dependencyId: '@rspack/plugin-react-refresh',
      // v1 exports the ctor as module.exports; v2 exports a namespace object.
      // Resolve the named export first so both major versions work.
      moduleAdapter: (mod) =>
        ((mod && (mod.default || mod.ReactRefreshRspackPlugin)) ||
          mod) as ReactRefreshPluginCtor
    })

  // The plugin would prepend its runtime to every entry, content scripts
  // included, and a MAIN world script then installs the React devtools hook
  // on the host page. JsFrameworksPlugin adds the entry to page entries only.
  const refreshEntry = resolveReactRefreshEntry(projectPath)

  const reactPlugins: RspackPluginInstance[] = [
    new ReactRefreshPlugin({
      overlay: false,
      injectEntry: !refreshEntry,
      ...(typeof options.refreshExclude === 'undefined'
        ? {}
        : {exclude: options.refreshExclude})
    }) as unknown as RspackPluginInstance
  ]

  return {
    plugins: reactPlugins,
    loaders: undefined,
    alias
  }
}

export function resolveReactRefreshEntry(
  projectPath: string
): string | undefined {
  try {
    const pluginMain = resolveOptionalContractPackageWithoutInstall({
      contractId: 'react-refresh',
      projectPath,
      dependencyId: '@rspack/plugin-react-refresh'
    })
    const marker = `${path.sep}@rspack${path.sep}plugin-react-refresh${path.sep}`
    const at = String(pluginMain || '').lastIndexOf(marker)
    if (at === -1) return undefined

    const root = String(pluginMain).slice(0, at + marker.length)
    const entry = path.join(root, 'client', 'reactRefreshEntry.js')

    return fs.existsSync(entry) ? entry : undefined
  } catch {
    return undefined
  }
}
