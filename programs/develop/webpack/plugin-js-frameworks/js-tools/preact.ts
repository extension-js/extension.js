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
import {JsFramework} from '../../webpack-types'
import {RspackPluginInstance} from '@rspack/core'
import {
  ensureOptionalModuleLoaded,
  ensureOptionalPackageResolved
} from '../../webpack-lib/optional-deps-resolver'

type PreactRefreshPluginCtor = new (...args: any[]) => RspackPluginInstance

let userMessageDelivered = false

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

  // Fast-refresh for Preact!
  // https://github.com/preactjs/prefresh
  const preactDependencies = [
    '@prefresh/core',
    '@prefresh/utils',
    '@rspack/plugin-preact-refresh',
    'preact'
  ]
  await ensureOptionalPackageResolved({
    integration: 'Preact',
    projectPath,
    dependencyId: '@rspack/plugin-preact-refresh',
    installDependencies: preactDependencies,
    verifyPackageIds: preactDependencies
  })

  const PreactRefreshPlugin =
    await ensureOptionalModuleLoaded<PreactRefreshPluginCtor>({
      integration: 'Preact',
      projectPath,
      dependencyId: '@rspack/plugin-preact-refresh',
      installDependencies: preactDependencies,
      verifyPackageIds: preactDependencies,
      moduleAdapter: (mod: any) =>
        ((mod && mod.default) || mod) as PreactRefreshPluginCtor
    })

  const preactPlugins: RspackPluginInstance[] = [
    new PreactRefreshPlugin({}) as any // TODO: cezaraugusto fix this
  ]

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

  const preactCompat = resolveFromProject('preact/compat')
  const preactTestUtils = resolveFromProject('preact/test-utils')
  const preactJsxRuntime = resolveFromProject('preact/jsx-runtime')
  const preactJsxDevRuntime = resolveFromProject('preact/jsx-dev-runtime')

  const alias: Record<string, string> = {}

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
