// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as path from 'path'
import * as fs from 'fs'
import {VueLoaderPlugin} from 'vue-loader'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'
import {JsFramework} from '../../webpack-types'
import {loadLoaderOptions} from '../load-loader-options'

let userMessageDelivered = false

export function isUsingVue(projectPath: string) {
  const packageJsonPath = path.join(projectPath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
  const vueAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.vue
  const vueAsDep = packageJson.dependencies && packageJson.dependencies.vue

  if (vueAsDevDep || vueAsDep) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.isUsingIntegration('Vue'))
      }

      userMessageDelivered = true
    }
  }

  return !!vueAsDevDep || !!vueAsDep
}

export async function maybeUseVue(
  projectPath: string
): Promise<JsFramework | undefined> {
  if (!isUsingVue(projectPath)) return undefined

  try {
    require.resolve('vue-loader')
  } catch (e) {
    const vueDependencies = [
      'vue-loader',
      'vue-template-compiler',
      '@vue/compiler-sfc'
    ]

    await installOptionalDependencies('Vue', vueDependencies)

    console.log(messages.youAreAllSet('Vue'))
    process.exit(0)
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

  const defaultPlugins: JsFramework['plugins'] = [new VueLoaderPlugin() as any]

  return {
    plugins: defaultPlugins,
    loaders: defaultLoaders,
    alias: undefined
  }
}
