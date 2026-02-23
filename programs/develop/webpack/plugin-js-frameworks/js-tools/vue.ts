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
import {DefinePlugin} from '@rspack/core'
import colors from 'pintor'
import * as messages from '../js-frameworks-lib/messages'
import {
  installOptionalDependencies,
  hasDependency,
  resolveDevelopInstallRoot
} from '../frameworks-lib/integrations'
import {JsFramework} from '../../webpack-types'
import {loadLoaderOptions} from '../js-frameworks-lib/load-loader-options'

type VueLoaderPluginCtor = new (...args: any[]) => {apply(compiler: any): void}

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

function getVueLoaderPlugin(
  projectPath: string
): VueLoaderPluginCtor | undefined {
  const extensionRoot = resolveDevelopInstallRoot()
  const bases = [projectPath, extensionRoot || undefined, process.cwd()].filter(
    Boolean
  ) as string[]

  for (const base of bases) {
    try {
      const req = createRequire(path.join(base, 'package.json'))
      const mod = req('vue-loader')
      const plugin =
        (mod && (mod as any).VueLoaderPlugin) ||
        (mod && (mod as any).default && (mod as any).default.VueLoaderPlugin)
      if (plugin) return plugin as VueLoaderPluginCtor
    } catch {
      // Try next base
    }
  }

  return undefined
}

export function isUsingVue(projectPath: string) {
  const using = hasDependency(projectPath, 'vue')
  if (using && !userMessageDelivered) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(
        `${colors.brightMagenta('►►► Author says')} ${messages.isUsingIntegration('Vue')}`
      )
    }
    userMessageDelivered = true
  }
  return using
}

export async function maybeUseVue(
  projectPath: string,
  mode: 'development' | 'production' | string = 'development'
): Promise<JsFramework | undefined> {
  if (!isUsingVue(projectPath)) return undefined

  let vueLoaderPath = resolveWithRuntimePaths('vue-loader', projectPath)

  if (!vueLoaderPath) {
    const vueDependencies = ['vue-loader', '@vue/compiler-sfc']

    const didInstall = await installOptionalDependencies('Vue', vueDependencies)

    if (!didInstall) {
      throw new Error('[Vue] Optional dependencies failed to install.')
    }

    vueLoaderPath = resolveWithRuntimePaths('vue-loader', projectPath)
    if (!vueLoaderPath) {
      throw new Error(
        '[Vue] vue-loader could not be resolved after optional dependency installation.'
      )
    }
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(messages.youAreAllSet('Vue'))
    }
  }

  const VueLoaderPlugin = getVueLoaderPlugin(projectPath)

  if (!VueLoaderPlugin) {
    throw new Error(
      '[Vue] vue-loader is installed but VueLoaderPlugin could not be resolved.'
    )
  }

  // Load custom loader configuration if it exists
  const customOptions = await loadLoaderOptions(projectPath, 'vue')

  const defaultLoaders: JsFramework['loaders'] = [
    {
      test: /\.vue$/,
      loader: vueLoaderPath,
      options: {
        experimentalInlineMatchResource: true,
        ...(customOptions || {})
      },
      include: projectPath,
      exclude: /node_modules/
    }
  ]

  const isProd = mode === 'production'
  const defaultPlugins: JsFramework['plugins'] = [
    new VueLoaderPlugin() as any,
    new DefinePlugin({
      __VUE_OPTIONS_API__: JSON.stringify(true),
      __VUE_PROD_DEVTOOLS__: JSON.stringify(!isProd),
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(!isProd)
    })
  ]

  // Force a single Vue runtime instance across app and transpiled workspace deps.
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

  const alias: Record<string, string> = {}
  const vuePath = resolveFromProject('vue')
  const vueRuntimeDom = resolveFromProject('@vue/runtime-dom')
  const vueRuntimeCore = resolveFromProject('@vue/runtime-core')
  const vueShared = resolveFromProject('@vue/shared')

  if (vuePath) alias['vue$'] = vuePath
  if (vueRuntimeDom) alias['@vue/runtime-dom'] = vueRuntimeDom
  if (vueRuntimeCore) alias['@vue/runtime-core'] = vueRuntimeCore
  if (vueShared) alias['@vue/shared'] = vueShared

  return {
    plugins: defaultPlugins,
    loaders: defaultLoaders,
    alias
  }
}
