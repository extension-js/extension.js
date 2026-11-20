//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {
  type Compiler,
  DefinePlugin,
  type RspackPluginInstance,
  WebpackError
} from '@rspack/core'
import {debugLine, isDebug, prefix} from '../../lib/messaging'
import {
  ensureOptionalContractModuleLoaded,
  ensureOptionalContractPackageResolved
} from '../../lib/optional-deps-resolver'
import type {JsFramework} from '../../types'
import {hasDependency} from '../frameworks-lib/integrations'
import {
  loadLoaderOptions,
  mergeLoaderOptions
} from '../js-frameworks-lib/load-loader-options'
import * as messages from '../js-frameworks-lib/messages'
import type {Notice, SessionNotices} from '../js-frameworks-lib/session-notices'

type VueLoaderPluginCtor = new (
  ...args: unknown[]
) => {apply(compiler: unknown): void}

export function isUsingVue(projectPath: string, notice?: Notice) {
  const using = hasDependency(projectPath, 'vue')

  if (using && notice && !notice.delivered) {
    if (isDebug()) {
      debugLine(`${prefix('debug')} ${messages.isUsingIntegration('Vue')}`)
    }

    notice.delivered = true
  }

  return using
}

// Bundlers get the runtime-only ESM build each Vue package names as `module`.
// A plain require.resolve lands on the CommonJS full build instead, which ships
// the template compiler: extension CSP cannot run it, and its innerHTML and
// Function calls fail the addons.mozilla.org store check.
export function resolveVueBundlerEntry(
  requireFromProject: NodeJS.Require,
  id: string
): string | undefined {
  try {
    const manifestPath = requireFromProject.resolve(`${id}/package.json`)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

    if (typeof manifest.module === 'string' && manifest.module) {
      const entry = path.join(path.dirname(manifestPath), manifest.module)
      if (fs.existsSync(entry)) return entry
    }
  } catch {
    // Ignore
  }

  try {
    return requireFromProject.resolve(id)
  } catch {
    return undefined
  }
}

// The installed Vue's version, from its own package.json, so a Vue 2 project
// is told before any loader is resolved or installed.
export function readInstalledVueVersion(
  requireFromProject: NodeJS.Require
): string | undefined {
  try {
    const manifestPath = requireFromProject.resolve('vue/package.json')
    const version = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version

    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined
  }
}

// vue-loader 15 throws on the layer keys the content script rules carry, so
// a Vue 2 single-file component cannot be built here. Render functions can.
class RefuseVueTwoSingleFileComponents {
  constructor(private readonly version: string) {}

  apply(compiler: Compiler) {
    const name = RefuseVueTwoSingleFileComponents.name

    compiler.hooks.thisCompilation.tap(name, (compilation) => {
      compilation.hooks.finishModules.tap(name, (modules) => {
        const files = new Set<string>()

        for (const module of modules) {
          const {resource = '', type} = module as {
            resource?: string
            type?: string
          }
          const file = resource.split('?')[0]

          // A project that brings its own .vue pipeline never lands on the
          // text rule, and is left to it.
          if (type === 'asset/source' && file.endsWith('.vue')) files.add(file)
        }

        if (files.size === 0) return

        const sorted = [...files].sort()
        const error = new WebpackError(
          messages.vueTwoSingleFileComponent(this.version, sorted)
        ) as Error & {file?: string}
        error.file = path.relative(compiler.context, sorted[0])
        // The message is the whole story, a stack would only point in here.
        error.stack = ''
        compilation.errors.push(error)
      })
    })
  }
}

// A Vue 2 project with no .vue file builds as plain JavaScript on the
// runtime-only entry. A .vue file is held as text so one clear error names it.
function vueTwoWithoutLoader(
  requireFromProject: NodeJS.Require,
  version: string
): JsFramework {
  const alias: Record<string, string> = {}
  const vuePath = resolveVueBundlerEntry(requireFromProject, 'vue')

  if (vuePath) alias.vue$ = vuePath

  return {
    plugins: [new RefuseVueTwoSingleFileComponents(version)],
    loaders: [{test: /\.vue$/, type: 'asset/source'}],
    alias
  }
}

type DefinePluginLike = {name?: unknown; _args?: unknown[]}

// Every key the project defines: the `define` key of extension.config.js,
// and any DefinePlugin a `config` hook added to the plugin list.
function definedKeys(
  compiler: Compiler,
  projectDefine: Record<string, unknown>
): Set<string> {
  const keys = new Set(Object.keys(projectDefine))

  for (const plugin of (compiler.options.plugins || []) as DefinePluginLike[]) {
    const definitions = plugin?.name === DefinePlugin.name && plugin._args?.[0]
    if (!definitions || typeof definitions !== 'object') continue

    for (const key of Object.keys(definitions)) keys.add(key)
  }

  return keys
}

// Vue's compile-time flags, as defaults. A flag the project defines itself
// keeps the project's value, with no conflict warning from the bundler.
export class VueFeatureFlagsPlugin {
  constructor(
    readonly flags: Record<string, string>,
    readonly projectDefine: Record<string, unknown> = {}
  ) {}

  apply(compiler: Compiler) {
    const taken = definedKeys(compiler, this.projectDefine)
    const free = Object.fromEntries(
      Object.entries(this.flags).filter(([key]) => !taken.has(key))
    )

    if (Object.keys(free).length > 0) {
      new DefinePlugin(free).apply(compiler)
    }
  }
}

export async function maybeUseVue(
  projectPath: string,
  mode: 'development' | 'production' | string = 'development',
  projectDefine: Record<string, unknown> = {},
  notices?: SessionNotices
): Promise<JsFramework | undefined> {
  if (!isUsingVue(projectPath, notices?.vue)) return undefined

  const requireFromProject = createRequire(
    path.join(projectPath, 'package.json')
  )
  const installedVersion = readInstalledVueVersion(requireFromProject)

  if (installedVersion && /^2\./.test(installedVersion)) {
    return vueTwoWithoutLoader(requireFromProject, installedVersion)
  }

  const vueLoaderPath = await ensureOptionalContractPackageResolved({
    contractId: 'vue',
    projectPath,
    dependencyId: 'vue-loader'
  })

  const VueLoaderPlugin =
    await ensureOptionalContractModuleLoaded<VueLoaderPluginCtor>({
      contractId: 'vue',
      projectPath,
      dependencyId: 'vue-loader',
      moduleAdapter: (mod) => {
        return (mod?.VueLoaderPlugin ||
          mod?.default?.VueLoaderPlugin) as VueLoaderPluginCtor
      }
    })

  const customOptions = await loadLoaderOptions(
    projectPath,
    'vue',
    notices?.customLoader
  )

  const defaultLoaders: JsFramework['loaders'] = [
    {
      test: /\.vue$/,
      loader: vueLoaderPath,
      options: mergeLoaderOptions(
        {experimentalInlineMatchResource: true},
        customOptions
      )
      // No include or exclude: a .vue file is always source, so one from a
      // dependency compiles like a project file, the way .svelte does.
    }
  ]

  const isProd = mode === 'production'
  const defaultPlugins: JsFramework['plugins'] = [
    new VueLoaderPlugin() as unknown as RspackPluginInstance,
    new VueFeatureFlagsPlugin(
      {
        // The Options API stays on in every mode: turning it off breaks each
        // component written with data(), methods or computed options.
        __VUE_OPTIONS_API__: JSON.stringify(true),
        __VUE_PROD_DEVTOOLS__: JSON.stringify(!isProd),
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(!isProd)
      },
      projectDefine
    ) as unknown as RspackPluginInstance
  ]

  // Force a single Vue runtime instance across app and transpiled workspace deps.
  const resolveFromProject = (id: string) =>
    resolveVueBundlerEntry(requireFromProject, id)

  const alias: Record<string, string> = {}
  const vuePath = resolveFromProject('vue')
  const vueRuntimeDom = resolveFromProject('@vue/runtime-dom')
  const vueRuntimeCore = resolveFromProject('@vue/runtime-core')
  const vueShared = resolveFromProject('@vue/shared')

  if (vuePath) alias.vue$ = vuePath
  if (vueRuntimeDom) alias['@vue/runtime-dom'] = vueRuntimeDom
  if (vueRuntimeCore) alias['@vue/runtime-core'] = vueRuntimeCore
  if (vueShared) alias['@vue/shared'] = vueShared

  return {
    plugins: defaultPlugins,
    loaders: defaultLoaders,
    alias
  }
}
