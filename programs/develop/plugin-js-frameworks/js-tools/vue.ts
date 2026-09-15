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
import {DefinePlugin, type RspackPluginInstance} from '@rspack/core'
import colors from 'pintor'
import {isDebug, prefix} from '../../lib/messaging'
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
    if (isDebug()) {
      console.log(`${prefix('debug')} ${messages.isUsingIntegration('Vue')}`)
    }
    userMessageDelivered = true
  }
  return using
}

// Bundlers get the runtime-only ESM build each Vue package names as `module`.
// A plain require.resolve lands on the CommonJS full build instead, which ships
// the template compiler: extension CSP cannot run it, and its innerHTML and
// Function calls fail the addons.mozilla.org store check.
export function resolveVueBundlerEntry(
  requireFromProject: NodeJS.Require,
  id: string
): string | undefined {
  try {
    const manifestPath = requireFromProject.resolve(`${id}/package.json`)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (typeof manifest.module === 'string' && manifest.module) {
      const entry = path.join(path.dirname(manifestPath), manifest.module)
      if (fs.existsSync(entry)) return entry
    }
  } catch {
    // Ignore
  }

  try {
    return requireFromProject.resolve(id)
  } catch {
    return undefined
  }
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
      // The Options API stays on in every mode: turning it off breaks each
      // component written with data(), methods or computed options.
      __VUE_OPTIONS_API__: JSON.stringify(true),
      __VUE_PROD_DEVTOOLS__: JSON.stringify(!isProd),
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(!isProd)
    })
  ]

  // Force a single Vue runtime instance across app and transpiled workspace deps.
  const requireFromProject = createRequire(
    path.join(projectPath, 'package.json')
  )
  const resolveFromProject = (id: string) =>
    resolveVueBundlerEntry(requireFromProject, id)

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
