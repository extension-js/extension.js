//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {createRequire} from 'module'
import colors from 'pintor'
import * as messages from '../js-frameworks-lib/messages'
import {
  installOptionalDependencies,
  hasDependency,
  resolveDevelopInstallRoot
} from '../frameworks-lib/integrations'
import {JsFramework} from '../../webpack-types'
import {RspackPluginInstance} from '@rspack/core'

type PreactRefreshPluginCtor = new (...args: any[]) => RspackPluginInstance

let userMessageDelivered = false

function resolveWithRuntimePaths(
  id: string,
  projectPath: string
): string | undefined {
  const extensionRoot = resolveDevelopInstallRoot()
  const bases = [projectPath, extensionRoot || undefined, process.cwd()].filter(
    Boolean
  ) as string[]

  for (const base of bases) {
    try {
      const req = createRequire(path.join(base, 'package.json'))
      return req.resolve(id)
    } catch {
      // Try next base
    }
  }

  try {
    return require.resolve(id, {paths: bases})
  } catch {
    return undefined
  }
}

function getPreactRefreshPlugin(
  projectPath: string
): PreactRefreshPluginCtor | undefined {
  const extensionRoot = resolveDevelopInstallRoot()
  const bases = [projectPath, extensionRoot || undefined, process.cwd()].filter(
    Boolean
  ) as string[]
  for (const base of bases) {
    try {
      const req = createRequire(path.join(base, 'package.json'))
      const mod = req('@rspack/plugin-preact-refresh')
      const plugin = (mod && (mod as any).default) || (mod as any)
      if (plugin) return plugin as PreactRefreshPluginCtor
    } catch {
      // Try next base
    }
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

  // Fast-refresh for Preact!
  // https://github.com/preactjs/prefresh
  let preactRefreshPath = resolveWithRuntimePaths(
    '@rspack/plugin-preact-refresh',
    projectPath
  )

  if (!preactRefreshPath) {
    const preactDependencies = [
      '@prefresh/core',
      '@prefresh/utils',
      '@rspack/plugin-preact-refresh',
      'preact'
    ]

    const didInstall = await installOptionalDependencies(
      'Preact',
      preactDependencies
    )

    if (!didInstall) {
      throw new Error('[Preact] Optional dependencies failed to install.')
    }

    preactRefreshPath = resolveWithRuntimePaths(
      '@rspack/plugin-preact-refresh',
      projectPath
    )
    if (!preactRefreshPath) {
      throw new Error(
        '[Preact] @rspack/plugin-preact-refresh could not be resolved after optional dependency installation.'
      )
    }
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(messages.youAreAllSet('Preact'))
    }
  }

  const PreactRefreshPlugin = getPreactRefreshPlugin(projectPath)

  if (!PreactRefreshPlugin) {
    throw new Error(
      '[Preact] @rspack/plugin-preact-refresh is installed but its plugin could not be resolved.'
    )
  }

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
