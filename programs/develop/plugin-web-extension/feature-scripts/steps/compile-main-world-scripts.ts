// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {Compilation, type Compiler, EntryPlugin} from '@rspack/core'
import {filterKeysForThisBrowser} from '../../../lib/manifest-utils'
import {stripBom} from '../../../lib/parse-json-safe'
import type {
  DevOptions,
  FilepathList,
  Manifest,
  PluginInterface
} from '../../../types'
import {
  EXTENSIONJS_CONTENT_SCRIPT_LAYER,
  getCanonicalContentScriptEntryName
} from '../contracts'
import {findRuntimeMainWorldEntries} from '../scripts-lib/runtime-main-world-scripts'
import {isRemoteUrl} from '../scripts-lib/utils'
import {createSequentialEntryModule} from './add-scripts'
import {
  withEagerDynamicImports,
  withoutDevRefresh
} from './trace-runtime-loaded-files'

export interface MainWorldGroup {
  index: number
  entryName: string
  files: string[]
}

interface MainWorldEntry {
  entryName: string
  files: string[]
}

// The MAIN world content script groups a dev build compiles apart: every js
// file local and present, no stylesheet, since a stylesheet rides the
// parent's entry and the group would then emit its bundle twice.
export function findMainWorldGroups(
  manifestPath: string,
  browser: DevOptions['browser']
): MainWorldGroup[] {
  let manifest: Manifest

  try {
    manifest = filterKeysForThisBrowser(
      JSON.parse(stripBom(fs.readFileSync(manifestPath, 'utf8'))) as Manifest,
      browser
    )
  } catch {
    return []
  }

  const groups = Array.isArray(manifest.content_scripts)
    ? (manifest.content_scripts as Array<Record<string, unknown>>)
    : []
  const manifestDir = path.dirname(manifestPath)
  const found: MainWorldGroup[] = []

  groups.forEach((group, index) => {
    if (group?.world !== 'MAIN') return

    const js = Array.isArray(group.js) ? (group.js as unknown[]) : []
    const css = Array.isArray(group.css) ? (group.css as unknown[]) : []
    if (js.length === 0 || css.length > 0) return

    const files: string[] = []

    for (const entry of js) {
      if (typeof entry !== 'string' || !entry || isRemoteUrl(entry)) return

      const abs = path.isAbsolute(entry)
        ? entry
        : path.join(manifestDir, entry.replace(/^\//, ''))
      if (!fs.existsSync(abs)) return

      files.push(abs)
    }

    found.push({
      index,
      entryName: getCanonicalContentScriptEntryName(index),
      files
    })
  })

  return found
}

type LooseRules = Parameters<typeof withoutDevRefresh>[0]

// In dev the bundler's HMR runtime rides every entry chunk, and a MAIN world
// script runs on the page itself, so the hot update callback landed on the
// host window. These groups compile in a child compilation instead: same
// loaders and resolution, no HMR plugin, emitted at the path the manifest
// and the dev registry already expect.
export class CompileMainWorldScripts {
  public static readonly name: string = 'scripts:compile-main-world'

  private readonly manifestPath: string
  private readonly browser: DevOptions['browser']
  private readonly includeList: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.includeList = options.includeList || {}
  }

  public apply(compiler: Compiler): void {
    if (compiler.options.mode !== 'development') return

    const manifestDir = path.dirname(this.manifestPath)
    const groups: MainWorldEntry[] = [
      ...findMainWorldGroups(this.manifestPath, this.browser),
      ...findRuntimeMainWorldEntries({
        includeList: this.includeList,
        manifestDir,
        projectPath: (compiler.options.context as string) || manifestDir
      })
    ]
    if (groups.length === 0) return

    const entries = compiler.options.entry as Record<string, unknown>

    for (const group of groups) {
      delete entries[group.entryName]
    }

    compiler.hooks.thisCompilation.tap(
      CompileMainWorldScripts.name,
      (compilation) => {
        compilation.hooks.processAssets.tapPromise(
          {
            name: CompileMainWorldScripts.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL
          },
          async () => {
            for (const group of groups) {
              await compileGroup(compiler, compilation, group)
            }
          }
        )
      }
    )
  }
}

// The parent hashes content bundles in dev so a reinject never serves a
// URL-cached copy, and leaves every other entry name alone; asking the
// parent's own resolver keeps a child bundle on that contract.
function outputFilenameFor(compiler: Compiler, entryName: string): string {
  const filename = compiler.options.output?.filename

  if (typeof filename === 'function') {
    return (filename as (data: {chunk: {name: string}}) => string)({
      chunk: {name: entryName}
    })
  }

  return `${entryName}.js`
}

async function compileGroup(
  compiler: Compiler,
  compilation: Compilation,
  group: MainWorldEntry
): Promise<void> {
  const request =
    group.files.length > 1
      ? createSequentialEntryModule(group.entryName, group.files)
      : group.files[0]

  const entry = new EntryPlugin(compiler.context, request, {
    name: group.entryName,
    filename: outputFilenameFor(compiler, group.entryName),
    layer: EXTENSIONJS_CONTENT_SCRIPT_LAYER,
    chunkLoading: 'jsonp'
  })

  const child = compilation.createChildCompiler(
    `${CompileMainWorldScripts.name}:${group.entryName}`,
    {
      filename: '[name].js',
      chunkFormat: 'array-push',
      chunkLoading: 'jsonp',
      clean: false
    } as unknown as Parameters<Compilation['createChildCompiler']>[1],
    [entry]
  )

  child.options.entry = {}
  child.options.optimization = {
    ...child.options.optimization,
    splitChunks: false,
    runtimeChunk: false
  }

  child.options.module = {
    ...child.options.module,
    // The browser loads the bundle as one file into the page, so a relative
    // import() is inlined rather than fetched from a chunk the page cannot see.
    parser: withEagerDynamicImports(
      child.options.module.parser as Record<string, unknown> | undefined
    ) as typeof child.options.module.parser,
    // Refresh signatures need the dev runtime the page entries carry.
    rules: withoutDevRefresh(
      child.options.module.rules as LooseRules
    ) as typeof child.options.module.rules
  }

  await new Promise<void>((resolve) => {
    child.runAsChild((error, _entries, childCompilation) => {
      if (error) {
        const ErrorCtor = compiler.rspack?.WebpackError || Error
        const failure = new ErrorCtor(
          `Compiling the MAIN world content script ${group.entryName} failed: ${error.message}`
        ) as Error & {name?: string}
        failure.name = 'MainWorldScriptCompileFailed'
        compilation.errors.push(failure as never)
      }

      if (childCompilation) {
        for (const childError of childCompilation.errors) {
          compilation.errors.push(childError)
        }

        for (const childWarning of childCompilation.warnings) {
          compilation.warnings.push(childWarning)
        }

        try {
          for (const dep of childCompilation.fileDependencies) {
            compilation.fileDependencies.add(dep)
          }

          for (const dep of childCompilation.contextDependencies) {
            compilation.contextDependencies.add(dep)
          }
        } catch {
          // Ignore, watch registration is best-effort
        }
      }

      resolve()
    })
  })
}
