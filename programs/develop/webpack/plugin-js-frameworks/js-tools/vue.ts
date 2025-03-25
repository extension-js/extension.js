// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import {VueLoaderPlugin} from 'vue-loader'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'
import {JsFramework} from '../../webpack-types'

let userMessageDelivered = false

export function isUsingVue(projectPath: string) {
  const packageJsonPath = path.join(projectPath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = require(packageJsonPath)
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
  projectPath: string,
  mode: 'development' | 'production'
): Promise<JsFramework | undefined> {
  if (!isUsingVue(projectPath)) return undefined

  try {
    require.resolve('vue-loader')
  } catch (e) {
    const vueDependencies = ['vue-loader', 'vue-template-compiler']

    await installOptionalDependencies('Vue', vueDependencies)

    console.log(messages.youAreAllSet('Vue'))
    process.exit(0)
  }

  const vueLoaders: JsFramework['loaders'] = [
    {
      test: /\.vue$/,
      loader: require.resolve('vue-loader'),
      options: {
        // Note, for the majority of features to be available, make sure this option is `true`
        experimentalInlineMatchResource: true
      },
      include: projectPath,
      exclude: /node_modules/
    }
  ]

  const vuePlugins: JsFramework['plugins'] = [new VueLoaderPlugin() as any]

  return {
    plugins: vuePlugins,
    loaders: vueLoaders,
    alias: undefined
  }
}
