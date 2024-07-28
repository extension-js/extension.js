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
import {isUsingTypeScript} from './typescript'

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

type Loader = Record<string, any>

export async function maybeUseVue(projectPath: string): Promise<Loader[]> {
  if (!isUsingVue(projectPath)) return []

  try {
    require.resolve('vue-loader')
  } catch (e) {
    const typeScriptDependencies = ['typescript', 'ts-loader']

    await installOptionalDependencies('TypeScript', typeScriptDependencies)

    const vueDependencies = ['vue-loader']

    await installOptionalDependencies('Vue', vueDependencies)

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet('Vue'))
    process.exit(0)
  }

  const vueLoaders: Loader[] = [
    {
      test: /\.vue$/,
      loader: require.resolve('vue-loader')
    }
  ]

  // use vue and typescript, need to add ts-loader
  if (isUsingTypeScript(projectPath)) {
    vueLoaders.push({
      test: /\.ts?$/,
      loader: require.resolve('ts-loader'),
      options: {
        appendTsSuffixTo: [/\.vue$/],
        // Skip type checking
        transpileOnly: true
      }
    })
  }

  return vueLoaders
}
