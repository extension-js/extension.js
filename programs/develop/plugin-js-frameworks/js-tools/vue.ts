//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createRequire} from 'node:module'
import * as path from 'node:path'
import {DefinePlugin, type RspackPluginInstance} from '@rspack/core'
import colors from 'pintor'
import {
  ensureOptionalContractModuleLoaded,
  ensureOptionalContractPackageResolved
} from '../../lib/optional-deps-resolver'
import type {JsFramework} from '../../types'
import {hasDependency} from '../frameworks-lib/integrations'
import {loadLoaderOptions} from '../js-frameworks-lib/load-loader-options'
import * as messages from '../js-frameworks-lib/messages'

type VueLoaderPluginCtor = new (
  ...args: unknown[]
) => {apply(compiler: unknown): void}

let userMessageDelivered = false

export function isUsingVue(projectPath: string) {
  const using = hasDependency(projectPath, 'vue')
  if (using && !userMessageDelivered) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(
        `${colors.brightMagenta('⏵⏵⏵ Author says')} ${messages.isUsingIntegration('Vue')}`
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

  const vueLoaderPath = await ensureOptionalContractPackageResolved({
    contractId: 'vue',
    projectPath,
    dependencyId: 'vue-loader'
  })

  const VueLoaderPlugin =
    await ensureOptionalContractModuleLoaded<VueLoaderPluginCtor>({
      contractId: 'vue',
      projectPath,
      dependencyId: 'vue-loader',
      moduleAdapter: (mod) => {
        return (mod?.VueLoaderPlugin ||
          mod?.default?.VueLoaderPlugin) as VueLoaderPluginCtor
      }
    })

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
    new VueLoaderPlugin() as unknown as RspackPluginInstance,
    new DefinePlugin({
      // Drop the Options API in production so Vue tree-shakes 10-20 KiB from bundles
      // content scripts pay for on every navigation; dev keeps it enabled.
      __VUE_OPTIONS_API__: JSON.stringify(!isProd),
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

  if (vuePath) alias.vue$ = vuePath
  if (vueRuntimeDom) alias['@vue/runtime-dom'] = vueRuntimeDom
  if (vueRuntimeCore) alias['@vue/runtime-core'] = vueRuntimeCore
  if (vueShared) alias['@vue/shared'] = vueShared

  return {
    plugins: defaultPlugins,
    loaders: defaultLoaders,
    alias
  }
}
