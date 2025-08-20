// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as path from 'path'
import * as fs from 'fs'
import * as messages from '../../webpack-lib/messages'
import {installOptionalDependencies} from '../../webpack-lib/utils'
import {JsFramework} from '../../webpack-types'
import {loadLoaderOptions} from '../load-loader-options'

let userMessageDelivered = false

export function isUsingSvelte(projectPath: string) {
  const packageJsonPath = path.join(projectPath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))

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

  try {
    require.resolve('svelte-loader')
  } catch (e) {
    const typeScriptDependencies = ['typescript']

    await installOptionalDependencies('TypeScript', typeScriptDependencies)

    const svelteDependencies = ['svelte-loader']

    await installOptionalDependencies('Svelte', svelteDependencies)

    console.log(messages.youAreAllSet('Svelte'))
    process.exit(0)
  }

  // Load custom loader configuration if it exists
  const customOptions = await loadLoaderOptions(projectPath, 'svelte')

  // Check if svelte.loader.js is being used
  const svelteLoaderPath = path.join(projectPath, 'svelte.loader.js')
  if (fs.existsSync(svelteLoaderPath)) {
    console.log(messages.isUsingIntegration('svelte.loader.js'))
  }

  const defaultLoaders: JsFramework['loaders'] = [
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
          emitCss: true,
          compilerOptions: {
            dev: mode === 'development',
            css: 'injected'
          },
          hotReload: mode === 'development',
          ...(customOptions || {})
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
    loaders: defaultLoaders,
    alias: undefined
  }
}
