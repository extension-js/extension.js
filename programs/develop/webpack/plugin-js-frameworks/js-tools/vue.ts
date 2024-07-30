// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import {Compiler} from 'webpack'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'
import {isUsingTypeScript} from './typescript'
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

  return vueAsDevDep || vueAsDep
}

export async function maybeUseVue(
  compiler: Compiler,
  projectPath: string
): Promise<JsFramework | undefined> {
  if (!isUsingVue(projectPath)) return undefined

  try {
    require.resolve('vue-loader')
  } catch (e) {
    const typeScriptDependencies = ['typescript', 'ts-loader']

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
      loader: 'vue-loader',
      include: path.resolve(__dirname, 'src')
    }
  ]

  // use vue and typescript, need to add ts-loader
  if (isUsingTypeScript(projectPath)) {
    vueLoaders.push({
      test: /\.ts?$/,
      loader: 'ts-loader',
      options: {
        appendTsSuffixTo: [/\.vue$/],
        // Skip type checking
        transpileOnly: true
      }
    })
  }

  // const {VueLoaderPlugin} = require('vue-loader')
  // new VueLoaderPlugin().apply(compiler)
  const vuePlugins: JsFramework['plugins'] = [
    new (require('vue-loader').VueLoaderPlugin)() //.apply(compiler)
  ]

  return {
    plugins: vuePlugins,
    loaders: vueLoaders,
    alias: undefined
  }
}
