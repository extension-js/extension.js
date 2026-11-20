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
import {usesReact} from '../../lib/framework-detect'
import {debugLine, isDebug, prefix} from '../../lib/messaging'
import {
  loadOptionalContractModuleWithoutInstall,
  resolveOptionalContractPackageWithoutInstall
} from '../../lib/optional-deps-resolver'
import type {JsFramework} from '../../types'
import {hasDependency} from '../frameworks-lib/integrations'
import * as messages from '../js-frameworks-lib/messages'
import type {Notice, SessionNotices} from '../js-frameworks-lib/session-notices'

const REACT_REFRESH_PLUGIN = '@rspack/plugin-react-refresh'

type ReactRefreshPluginCtor = new (...args: unknown[]) => RspackPluginInstance

type MaybeUseReactOptions = {
  refreshExclude?: unknown
  disableRefresh?: boolean
  notices?: SessionNotices
}

export function isUsingReact(projectPath: string, notice?: Notice) {
  if (usesReact(projectPath)) {
    if (notice && !notice.delivered) {
      if (isDebug()) {
        debugLine(`${prefix('debug')} ${messages.isUsingIntegration('React')}`)
      }

      notice.delivered = true
    }

    return true
  }

  return false
}

export async function maybeUseReact(
  projectPath: string,
  options: MaybeUseReactOptions = {}
): Promise<JsFramework | undefined> {
  if (!isUsingReact(projectPath, options.notices?.react)) return undefined

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
      // v1 exports the ctor as module.exports, v2 a namespace with only the
      // named export: a default wins, then the named export, then the module.
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

// Asked of the plugin package itself, through the export it declares for the
// entry, so the file is found wherever the package keeps it.
export function resolveReactRefreshEntry(
  projectPath: string
): string | undefined {
  try {
    const pluginMain = resolveOptionalContractPackageWithoutInstall({
      contractId: 'react-refresh',
      projectPath,
      dependencyId: '@rspack/plugin-react-refresh'
    })
    const entry = createRequire(String(pluginMain)).resolve(
      `${REACT_REFRESH_PLUGIN}/react-refresh-entry`
    )

    return fs.existsSync(entry) ? entry : undefined
  } catch {
    return undefined
  }
}
