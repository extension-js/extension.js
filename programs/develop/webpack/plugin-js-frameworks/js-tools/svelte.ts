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

export function isUsingSvelte(projectPath: string) {
  const packageJsonPath = path.join(projectPath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = require(packageJsonPath)

  const svelteAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies?.svelte
  const svelteAsDep =
    packageJson.dependencies && packageJson.dependencies.svelte

  if (svelteAsDevDep || svelteAsDep) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.isUsingIntegration('Svelte'))
      }

      userMessageDelivered = true
    }
  }

  return !!svelteAsDevDep || !!svelteAsDep
}

export async function maybeUseSvelte(
  projectPath: string
): Promise<JsFramework | undefined> {
  if (!isUsingSvelte(projectPath)) return undefined

  const isDev = process.env.NODE_ENV !== 'production'

  try {
    require.resolve('svelte-loader')
  } catch (e) {
    const typeScriptDependencies = ['typescript']

    await installOptionalDependencies('TypeScript', typeScriptDependencies)

    const svelteDependencies = ['svelte-loader', 'svelte-preprocess']

    await installOptionalDependencies('Svelte', svelteDependencies)

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet('Svelte'))
    process.exit(0)
  }

  const svelteLoaders: JsFramework['loaders'] = [
    {
      test: /\.svelte$/,
      loader: require.resolve('svelte-loader'),
      include: projectPath,
      exclude: /node_modules/,
      options: {
        compilerOptions: {
          dev: isDev
        },
        hotReload: isDev,
        preprocess: require('svelte-preprocess')()
      }
    }
  ]

  return {
    plugins: undefined,
    loaders: svelteLoaders,
    alias: undefined
  }
}
