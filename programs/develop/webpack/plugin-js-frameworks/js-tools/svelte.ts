//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {createRequire} from 'module'
import * as messages from '../js-frameworks-lib/messages'
import {hasDependency} from '../frameworks-lib/integrations'
import type {JsFramework} from '../../webpack-types'
import {loadLoaderOptions} from '../js-frameworks-lib/load-loader-options'
import type {DevOptions} from '../../webpack-types'
import {ensureOptionalPackageResolved} from '../../webpack-lib/optional-deps-resolver'

let userMessageDelivered = false

function resolveFromProject(id: string, projectPath: string) {
  for (const base of [projectPath, process.cwd()]) {
    try {
      const req = createRequire(path.join(base, 'package.json'))
      return req.resolve(id)
    } catch {
      // Try next base
    }
  }
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

  const svelteLoaderPath = await ensureOptionalPackageResolved({
    integration: 'Svelte',
    projectPath,
    dependencyId: 'svelte-loader',
    installDependencies: ['typescript', 'svelte-loader'],
    verifyPackageIds: ['typescript', 'svelte-loader']
  })

  // Ensure TypeScript is available for Svelte toolchain expectations (even without preprocess)
  await ensureOptionalPackageResolved({
    integration: 'TypeScript',
    projectPath,
    dependencyId: 'typescript',
    installDependencies: ['typescript'],
    verifyPackageIds: ['typescript']
  })

  // Load custom loader configuration if it exists
  const customOptions = await loadLoaderOptions(projectPath, 'svelte')

  // Resolve toolchain/runtime from the project when available
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

  const sveltePackageJson = resolveFromProject(
    'svelte/package.json',
    projectPath
  )
  const sveltePackageRoot = sveltePackageJson
    ? path.dirname(sveltePackageJson)
    : undefined

  const resolveClientSubpath = (relative: string) => {
    const direct = resolveFromProject(`svelte/${relative}`, projectPath)
    if (direct) return direct
    if (!sveltePackageRoot) return undefined

    const fromRoot = path.join(sveltePackageRoot, relative)
    return fs.existsSync(fromRoot) ? fromRoot : undefined
  }

  // Force browser/client Svelte entrypoints so bundling never drifts into
  // worker/default server branches for extension targets.
  const alias: Record<string, string> = {}
  const svelteClient = resolveClientSubpath('src/index-client.js')
  const svelteStoreClient = resolveClientSubpath('src/store/index-client.js')
  const svelteReactivityClient = resolveClientSubpath(
    'src/reactivity/index-client.js'
  )
  const svelteLegacyClient = resolveClientSubpath('src/legacy/legacy-client.js')

  if (svelteClient) alias.svelte = svelteClient
  if (svelteStoreClient) alias['svelte/store'] = svelteStoreClient
  if (svelteReactivityClient)
    alias['svelte/reactivity'] = svelteReactivityClient
  if (svelteLegacyClient) alias['svelte/legacy'] = svelteLegacyClient

  // Small plugin to update resolver fields to align with Svelte ecosystem
  const resolverPlugin = {
    apply(compiler: any) {
      const existingMainFields =
        (compiler.options.resolve && compiler.options.resolve.mainFields) || []
      const existingExtensions =
        (compiler.options.resolve && compiler.options.resolve.extensions) || []
      const existingAlias =
        (compiler.options.resolve && compiler.options.resolve.alias) || {}
      const existingModules =
        (compiler.options.resolve && compiler.options.resolve.modules) || []

      // de-duplicate while preserving order
      const dedupe = (arr: string[]) => Array.from(new Set(arr))

      compiler.options.resolve = {
        ...compiler.options.resolve,
        // Respect existing resolver field priority from the host config.
        mainFields: dedupe(existingMainFields),
        // Keep the host bundler/browser conditions untouched.
        // Forcing `svelte` as an export condition can resolve server-oriented
        // package entries that pull `node:` built-ins in browser builds.
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
    alias: Object.keys(alias).length > 0 ? alias : undefined
  }
}
