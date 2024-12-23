// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import {sveltePreprocess} from 'svelte-preprocess'
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
  projectPath: string,
  mode: 'development' | 'production'
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

    console.log(messages.youAreAllSet('Svelte'))
    process.exit(0)
  }

  const svelteLoaders: JsFramework['loaders'] = [
    {
      test: /\.svelte\.ts$/,
      use: [require.resolve('svelte-loader')],
      include: projectPath,
      exclude: /node_modules/
    },
    {
      test: /\.(svelte|svelte\.js)$/,
      use: {
        loader: require.resolve('svelte-loader'),
        options: {
          preprocess: sveltePreprocess({
            typescript: true,
            postcss: true
          }),
          emitCss: true,
          compilerOptions: {
            dev: mode === 'development'
          }
        }
      },
      include: projectPath,
      exclude: /node_modules/
    },
    {
      // Required to prevent errors from Svelte on Webpack 5+
      test: /node_modules\/svelte\/.*\.mjs$/,
      resolve: {
        fullySpecified: false
      }
    }
  ]

  return {
    plugins: undefined,
    loaders: svelteLoaders,
    alias: undefined
  }
}
