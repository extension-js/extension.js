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
import {recordCodedWarning} from '../../lib/coded-warnings'
import {usesSvelte} from '../../lib/framework-detect'
import {
  CODES,
  debugLine,
  humanWarn,
  isDebug,
  prefix,
  stripChannelPrefix
} from '../../lib/messaging'
import {ensureOptionalContractPackageResolved} from '../../lib/optional-deps-resolver'
import type {DevOptions, JsFramework} from '../../types'
import {
  loadLoaderOptions,
  mergeLoaderOptions
} from '../js-frameworks-lib/load-loader-options'
import * as messages from '../js-frameworks-lib/messages'
import type {Notice, SessionNotices} from '../js-frameworks-lib/session-notices'

// Only the project the compiler was given is asked. The folder a command
// runs from can hold another svelte, and that one is not this project's.
function resolveFromProject(id: string, projectPath: string) {
  try {
    return createRequire(path.join(projectPath, 'package.json')).resolve(id)
  } catch {
    return undefined
  }
}

function readPackageVersion(packageJsonPath: string): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
      version?: string
    }

    return typeof parsed.version === 'string' ? parsed.version : undefined
  } catch {
    return undefined
  }
}

// svelte-loader does `require('svelte/compiler')` when it loads, so the svelte
// beside the loader is the one that compiles, wherever the loader lives.
export function resolveCompilerSvelte(loaderPath: string): {
  root?: string
  version?: string
} {
  try {
    const req = createRequire(loaderPath)
    const packageJsonPath = req.resolve('svelte/package.json')

    return {
      root: path.dirname(packageJsonPath),
      version: readPackageVersion(packageJsonPath)
    }
  } catch {
    return {}
  }
}

interface SvelteRootChoice {
  root?: string
  // True when the compiler and the project hold different svelte versions, so
  // the runtime has to follow the compiler for the bundle to link and run.
  mismatch: boolean
  compilerVersion?: string
  projectVersion?: string
}

export function chooseSvelteRoot(input: {
  projectRoot?: string
  projectVersion?: string
  compilerRoot?: string
  compilerVersion?: string
}): SvelteRootChoice {
  const {projectRoot, projectVersion, compilerRoot, compilerVersion} = input
  // Either direction breaks. Compiled output and runtime are one release: the
  // 5.59 compiler emits the DOM setup import its runtime stopped running.
  const mismatch = Boolean(
    projectRoot &&
      compilerRoot &&
      projectVersion &&
      compilerVersion &&
      projectVersion !== compilerVersion
  )

  return {
    root: mismatch ? compilerRoot : projectRoot || compilerRoot,
    mismatch,
    compilerVersion,
    projectVersion
  }
}

type ResolveOptions = NonNullable<
  import('@rspack/core').Compiler['options']['resolve']
>

// Svelte libraries publish under the `svelte` export condition, often with no
// other key, so a Svelte project offers it first, as vite-plugin-svelte does.
function withSvelteCondition(
  conditionNames: ResolveOptions['conditionNames']
): ResolveOptions['conditionNames'] {
  if (!Array.isArray(conditionNames)) return conditionNames
  if (conditionNames.includes('svelte')) return conditionNames

  return ['svelte', ...conditionNames]
}

// Only the script resolvers take it: the stylesheet ones keep their own list.
function withSvelteConditionByDependency(
  byDependency: ResolveOptions['byDependency']
): ResolveOptions['byDependency'] {
  if (!byDependency) return byDependency

  const next: NonNullable<ResolveOptions['byDependency']> = {}

  for (const [dependencyType, options] of Object.entries(byDependency)) {
    const names = options?.conditionNames
    const isScript =
      Array.isArray(names) &&
      (names.includes('import') || names.includes('require'))

    next[dependencyType] = isScript
      ? {...options, conditionNames: withSvelteCondition(names)}
      : options
  }

  return next
}

export function isUsingSvelte(projectPath: string, notice?: Notice) {
  const using = usesSvelte(projectPath)

  if (using && notice && !notice.delivered) {
    if (isDebug()) {
      debugLine(`${prefix('debug')} ${messages.isUsingIntegration('Svelte')}`)
    }

    notice.delivered = true
  }

  return using
}

export async function maybeUseSvelte(
  projectPath: string,
  mode: DevOptions['mode'],
  {
    notices,
    compiler,
    hotReload = true
  }: {
    notices?: SessionNotices
    // False for a build no session reloads.
    hotReload?: boolean
    // The build the mismatch warning is counted in.
    compiler?: object
  } = {}
): Promise<JsFramework | undefined> {
  if (!isUsingSvelte(projectPath, notices?.svelte)) return undefined

  const svelteLoaderPath = await ensureOptionalContractPackageResolved({
    contractId: 'svelte',
    projectPath,
    dependencyId: 'svelte-loader'
  })

  // No `typescript` check here: svelte-loader does not depend on it, and
  // requiring it would hard-fail Svelte projects that never asked for TS.
  const customOptions = await loadLoaderOptions(
    projectPath,
    'svelte',
    notices?.customLoader
  )

  const svelteLoader = {
    loader: svelteLoaderPath,
    options: mergeLoaderOptions(
      {
        emitCss: true,
        compilerOptions: {
          dev: mode === 'development'
        },
        // Do not use svelte-preprocess; rely on Svelte 5 built-in TS support.
        hotReload: mode === 'development' && hotReload
      },
      customOptions
    )
  }

  const defaultLoaders: JsFramework['loaders'] = [
    {
      test: /\.svelte\.ts$/,
      // compileModule parses plain JavaScript only, so the types come off before
      // svelte-loader runs; esnext keeps class fields where runes expect them.
      use: [
        svelteLoader,
        {
          loader: 'builtin:swc-loader',
          options: {
            jsc: {
              parser: {syntax: 'typescript'},
              target: 'esnext'
            }
          }
        }
      ]
    },
    {
      test: /\.(svelte|svelte\.js)$/,
      use: svelteLoader
      // No include and no exclude: a .svelte source is only ever readable by
      // this compiler, wherever it lives, and the ecosystem ships them on npm.
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
  const projectRoot = sveltePackageJson
    ? path.dirname(sveltePackageJson)
    : undefined
  const compilerSvelte = resolveCompilerSvelte(svelteLoaderPath)
  const chosen = chooseSvelteRoot({
    projectRoot,
    projectVersion: sveltePackageJson
      ? readPackageVersion(sveltePackageJson)
      : undefined,
    compilerRoot: compilerSvelte.root,
    compilerVersion: compilerSvelte.version
  })
  const sveltePackageRoot = chosen.root

  if (chosen.mismatch && !notices?.svelteMismatch.delivered) {
    const frame = messages.svelteCompilerRuntimeMismatch(
      String(chosen.compilerVersion),
      String(chosen.projectVersion)
    )

    recordCodedWarning(
      CODES.W_MANAGED_DEP_CONFLICT,
      stripChannelPrefix(frame),
      compiler
    )

    humanWarn(frame)

    if (notices) notices.svelteMismatch.delivered = true
  }

  const resolveClientSubpath = (relative: string) => {
    // On a mismatch the project's copy is the wrong one: its runtime cannot
    // link the exports the compiler just emitted, so only the root wins here.
    if (!chosen.mismatch) {
      const direct = resolveFromProject(`svelte/${relative}`, projectPath)
      if (direct) return direct
    }

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

  if (svelteReactivityClient) {
    alias['svelte/reactivity'] = svelteReactivityClient
  }

  if (svelteLegacyClient) alias['svelte/legacy'] = svelteLegacyClient

  // The compiled component imports svelte/internal/client directly. It was the
  // one entry left to normal resolution, which is how a project's older runtime
  // ended up linking against code a newer compiler emitted.
  const svelteInternal = sveltePackageRoot
    ? path.join(sveltePackageRoot, 'src', 'internal')
    : undefined

  if (svelteInternal && fs.existsSync(svelteInternal)) {
    alias['svelte/internal'] = svelteInternal
  }

  const resolverPlugin = {
    apply(compiler: import('@rspack/core').Compiler) {
      const existingExtensions = compiler.options.resolve?.extensions || []
      const existingModules = compiler.options.resolve?.modules || []

      const dedupe = (arr: string[]) => Array.from(new Set(arr))

      const {conditionNames, byDependency} = compiler.options.resolve || {}

      compiler.options.resolve = {
        ...compiler.options.resolve,
        ...(conditionNames
          ? {conditionNames: withSvelteCondition(conditionNames)}
          : {}),
        ...(byDependency
          ? {byDependency: withSvelteConditionByDependency(byDependency)}
          : {}),
        // With no list of its own the compiler keeps the bundler's defaults,
        // which the three dots stand for, and .svelte comes after them.
        extensions:
          existingExtensions.length > 0
            ? dedupe(['.svelte', ...existingExtensions])
            : ['...', '.svelte'],
        // After the walk up from the importer, so a package keeps the copy
        // of a dependency installed inside it.
        modules: dedupe([
          ...(existingModules.length > 0 ? existingModules : ['node_modules']),
          path.join(projectPath, 'node_modules')
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
