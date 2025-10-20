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
import {hasDependency} from '../../webpack-lib/utils'
import {loadLoaderOptions} from '../load-loader-options'
import {type DevOptions} from '../../../develop-lib/config-types'

let userMessageDelivered = false

export function isUsingSvelte(projectPath: string) {
  const using = hasDependency(projectPath, 'svelte')
  if (using && !userMessageDelivered) {
    if (process.env.EXTENSION_ENV === 'development') {
      console.log(messages.isUsingIntegration('Svelte'))
    }
    userMessageDelivered = true
  }
  return using
}

export async function maybeUseSvelte(
  projectPath: string,
  mode: DevOptions['mode']
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

  // Ensure TypeScript is available for Svelte toolchain expectations (even without preprocess)
  try {
    require.resolve('typescript')
  } catch (e) {
    const typeScriptDependencies = ['typescript']
    await installOptionalDependencies('TypeScript', typeScriptDependencies)
    console.log(messages.youAreAllSet('TypeScript'))
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
            dev: mode === 'development'
          },
          // Do not use svelte-preprocess; rely on Svelte 5 built-in TS support.
          hotReload: mode === 'development',
          ...(customOptions || {})
        }
      },
      include: projectPath,
      exclude: /node_modules/
    },
    {
      // Required to prevent errors from Svelte on Webpack/Rspack 5+
      test: /node_modules\/svelte\/.*\.mjs$/,
      resolve: {
        fullySpecified: false
      }
    }
  ]

  // Do not alias 'svelte'; rely on export maps for subpath resolution
  const alias: Record<string, string> | undefined = undefined

  // Small plugin to update resolver fields to align with Svelte ecosystem
  const resolverPlugin = {
    apply(compiler: any) {
      const existingMainFields =
        (compiler.options.resolve && compiler.options.resolve.mainFields) || []
      const existingConditionNames =
        (compiler.options.resolve &&
          (compiler.options.resolve.conditionNames ||
            compiler.options.resolve.conditions)) ||
        []
      const existingExtensions =
        (compiler.options.resolve && compiler.options.resolve.extensions) || []

      const nextMainFields = [
        'svelte',
        'browser',
        'module',
        'main',
        ...existingMainFields
      ]
      // de-duplicate while preserving order
      const dedupe = (arr: string[]) => Array.from(new Set(arr))

      compiler.options.resolve = {
        ...compiler.options.resolve,
        mainFields: dedupe(nextMainFields),
        conditionNames: dedupe(['svelte', ...existingConditionNames]),
        extensions: dedupe(['.svelte', ...existingExtensions])
      }
    }
  }

  return {
    plugins: [resolverPlugin],
    loaders: defaultLoaders,
    alias
  }
}
