//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {DefinePlugin} from '@rspack/core'
import colors from 'pintor'
import * as messages from '../js-frameworks-lib/messages'
import {
  installOptionalDependencies,
  hasDependency
} from '../frameworks-lib/integrations'
import {JsFramework} from '../../webpack-types'
import {loadLoaderOptions} from '../js-frameworks-lib/load-loader-options'

type VueLoaderPluginCtor = new (...args: any[]) => {apply(compiler: any): void}

let userMessageDelivered = false
let cachedVueLoaderPlugin: VueLoaderPluginCtor | undefined

function getVueLoaderPlugin(): VueLoaderPluginCtor | undefined {
  if (cachedVueLoaderPlugin) return cachedVueLoaderPlugin
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('vue-loader')
    const plugin =
      (mod && (mod as any).VueLoaderPlugin) ||
      (mod && (mod as any).default && (mod as any).default.VueLoaderPlugin)
    if (plugin) {
      cachedVueLoaderPlugin = plugin as VueLoaderPluginCtor
      return cachedVueLoaderPlugin
    }
  } catch {
    // If vue-loader isn't installed or the export shape changed,
    // we fall through and let maybeUseVue handle error signalling.
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

  try {
    require.resolve('vue-loader')
  } catch (e) {
    const vueDependencies = ['vue-loader', '@vue/compiler-sfc']

    await installOptionalDependencies('Vue', vueDependencies)

    console.log(messages.youAreAllSet('Vue'))
    process.exit(0)
  }

  const VueLoaderPlugin = getVueLoaderPlugin()

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
      loader: require.resolve('vue-loader'),
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

  return {
    plugins: defaultPlugins,
    loaders: defaultLoaders,
    alias: undefined
  }
}
