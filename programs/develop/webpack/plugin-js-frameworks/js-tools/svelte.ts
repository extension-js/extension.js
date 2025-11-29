// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as path from 'path'
import * as fs from 'fs'
import * as messages from '../js-frameworks-lib/messages'
import {
  installOptionalDependencies,
  hasDependency
} from '../frameworks-lib/integrations'
import type {JsFramework} from '../../webpack-types'
import {loadLoaderOptions} from '../js-frameworks-lib/load-loader-options'
import type {DevOptions} from '../../webpack-types'

let userMessageDelivered = false

function resolveFromProject(id: string, projectPath: string) {
  try {
    return require.resolve(id, {paths: [projectPath, process.cwd()]})
  } catch {
    return undefined
  }
}

export function isUsingSvelte(projectPath: string) {
  const using = hasDependency(projectPath, 'svelte')
  if (using && !userMessageDelivered) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
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
    resolveFromProject('svelte-loader', projectPath) ||
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
    require.resolve('typescript', {paths: [projectPath, process.cwd()]})
  } catch (e) {
    const typeScriptDependencies = ['typescript']
    await installOptionalDependencies('TypeScript', typeScriptDependencies)
    console.log(messages.youAreAllSet('TypeScript'))
    process.exit(0)
  }

  // Load custom loader configuration if it exists
  const customOptions = await loadLoaderOptions(projectPath, 'svelte')

  // Resolve toolchain/runtime from the project when available
  const svelteLoaderPath =
    resolveFromProject('svelte-loader', projectPath) ||
    require.resolve('svelte-loader')

  const defaultLoaders: JsFramework['loaders'] = [
    {
      test: /\.svelte\.ts$/,
      use: [svelteLoaderPath],
      include: projectPath,
      exclude: /node_modules/
    },
    {
      test: /\.(svelte|svelte\.js)$/,
      use: {
        loader: svelteLoaderPath,
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
      test: /[\\/]node_modules[\\/]svelte[\\/].*\.mjs$/,
      resolve: {
        fullySpecified: false
      }
    }
  ]

  // Do not alias 'svelte'; prioritize project node_modules instead
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
      const existingAlias =
        (compiler.options.resolve && compiler.options.resolve.alias) || {}
      const existingModules =
        (compiler.options.resolve && compiler.options.resolve.modules) || []

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
        extensions: dedupe(['.svelte', ...existingExtensions]),
        alias: existingAlias,
        modules: dedupe([
          path.join(projectPath, 'node_modules'),
          ...existingModules
        ])
      }
    }
  }

  return {
    plugins: [resolverPlugin],
    loaders: defaultLoaders,
    alias
  }
}
