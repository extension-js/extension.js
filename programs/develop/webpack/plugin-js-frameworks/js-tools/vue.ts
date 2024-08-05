// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'
import {JsFramework} from '../../webpack-types'

let userMessageDelivered = false

export function isUsingVue(projectPath: string) {
  const packageJsonPath = path.join(projectPath, 'package.json')
  const manifestJsonPath = path.join(projectPath, 'manifest.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = require(packageJsonPath)
  const vueAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.vue
  const vueAsDep = packageJson.dependencies && packageJson.dependencies.vue

  if (vueAsDevDep || vueAsDep) {
    if (!userMessageDelivered) {
      const manifest = require(manifestJsonPath)
      console.log(messages.isUsingTechnology(manifest, 'Vue'))

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
    const typeScriptDependencies = ['typescript']

    await installOptionalDependencies('TypeScript', typeScriptDependencies)

    const vueDependencies = [
      'vue-loader',
      '@vue/compiler-sfc',
      'vue-template-compiler',
      'vue-style-loader'
    ]

    await installOptionalDependencies('Vue', vueDependencies)

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet('Vue'))
    process.exit(0)
  }

  const vueLoaders: JsFramework['loaders'] = [
    {
      test: /\.vue$/,
      loader: require.resolve('vue-loader'),
      include: projectPath
    }
  ]

  const vuePlugins: JsFramework['plugins'] = [
    new (require('vue-loader').VueLoaderPlugin)() //.apply(compiler)
  ]

  return {
    plugins: vuePlugins,
    loaders: vueLoaders,
    alias: undefined
  }
}
