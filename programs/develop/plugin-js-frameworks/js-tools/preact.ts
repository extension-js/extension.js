//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import {createRequire} from 'module'
import colors from 'pintor'
import * as messages from '../js-frameworks-lib/messages'
import {hasDependency} from '../frameworks-lib/integrations'
import {JsFramework} from '../../types'
import {RspackPluginInstance} from '@rspack/core'
import {
  ensureOptionalContractModuleLoaded,
  ensureOptionalContractPackageResolved
} from '../../lib/optional-deps-resolver'

type PreactRefreshPluginCtor = new (...args: any[]) => RspackPluginInstance

let userMessageDelivered = false

export function isUsingPreact(projectPath: string) {
  if (hasDependency(projectPath, 'preact')) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          `${colors.brightMagenta('⏵⏵⏵ Author says')} ${messages.isUsingIntegration('Preact')}`
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

  // Fast-refresh for Preact!
  // https://github.com/preactjs/prefresh
  await ensureOptionalContractPackageResolved({
    contractId: 'preact-refresh',
    projectPath,
    dependencyId: '@rspack/plugin-preact-refresh'
  })

  const PreactRefreshPlugin =
    await ensureOptionalContractModuleLoaded<PreactRefreshPluginCtor>({
      contractId: 'preact-refresh',
      projectPath,
      dependencyId: '@rspack/plugin-preact-refresh',
      moduleAdapter: (mod: any) =>
        ((mod && mod.default) || mod) as PreactRefreshPluginCtor
    })

  const requireFromProject = createRequire(
    path.join(projectPath, 'package.json')
  )
  const resolveFromProject = (id: string) => {
    try {
      return requireFromProject.resolve(id)
    } catch {
      return undefined
    }
  }

  const preactPkgJson = resolveFromProject('preact/package.json')
  const preactDir = preactPkgJson ? path.dirname(preactPkgJson) : undefined
  const preactCompat = resolveFromProject('preact/compat')
  const preactTestUtils = resolveFromProject('preact/test-utils')
  const preactJsxRuntime = resolveFromProject('preact/jsx-runtime')
  const preactJsxDevRuntime = resolveFromProject('preact/jsx-dev-runtime')

  // The plugin sets `compiler.options.resolve.alias.preact = options.preactPath`
  // and stops resolving `preact` through Node when this is undefined. In pnpm
  // strict layouts the plugin lives at .pnpm/@rspack+plugin-preact-refresh/.../
  // which doesn't sibling-link `preact`, so without an explicit path the alias
  // becomes `preact: undefined` and webpack falls back to a Node lookup that
  // can't reach the user's preact symlink. Pass the project-resolved preact
  // package directory (not the entry file — webpack alias treats values as
  // prefixes for sub-paths like `preact/hooks`) so HMR works regardless of
  // node-linker mode.
  const preactPlugins: RspackPluginInstance[] = [
    new PreactRefreshPlugin(preactDir ? {preactPath: preactDir} : {}) as any
  ]

  const alias: Record<string, string> = {}

  if (preactDir) {
    alias.preact = preactDir
  }

  if (preactCompat) {
    alias.react = preactCompat
    alias['react-dom'] = preactCompat
  }

  if (preactTestUtils) {
    alias['react-dom/test-utils'] = preactTestUtils
  }

  if (preactJsxRuntime) {
    alias['react/jsx-runtime'] = preactJsxRuntime
  }

  if (preactJsxDevRuntime) {
    alias['react/jsx-dev-runtime'] = preactJsxDevRuntime
  }

  return {
    plugins: preactPlugins,
    loaders: undefined,
    alias
  }
}
