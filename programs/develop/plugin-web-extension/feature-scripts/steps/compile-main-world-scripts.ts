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
import {resolveDevelopDistFile} from '../../../lib/develop-context'
import {filterKeysForThisBrowser} from '../../../lib/manifest-utils'
import {parseAuthoredJson} from '../../../lib/parse-json-safe'
import type {
  DevOptions,
  FilepathList,
  Manifest,
  PluginInterface
} from '../../../types'
import {
  EXTENSIONJS_CONTENT_SCRIPT_LAYER,
  EXTENSIONJS_MAIN_WORLD_IMPORT_LAYER,
  getCanonicalContentScriptEntryName,
  markMainWorldCompiler
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
      parseAuthoredJson(fs.readFileSync(manifestPath, 'utf8')) as Manifest,
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

// The wrapper judges each module by its own path, so a scripts/ file this
// bundle imports would bring the isolated world's page patches along.
function withMainWorldBundle(rules: LooseRules): LooseRules {
  const wrapper = resolveDevelopDistFile(
    'feature-scripts-content-script-wrapper'
  )

  return rules.map((rule) => {
    if (!rule || typeof rule !== 'object' || !Array.isArray(rule.use)) {
      return rule
    }

    return {
      ...rule,
      use: rule.use.map((use) =>
        typeof use === 'object' && use.loader === wrapper
          ? {...use, options: {...use.options, mainWorldBundle: true}}
          : use
      )
    }
  })
}

// The name the bundler gives a CSS module class in a development build.
const DEV_CLASS_NAME = '[uniqueName]-[id]-[local]'

type LooseGenerator = Record<string, Record<string, unknown>> | undefined

// A dev class name carries its module's id, and each child numbers its own
// modules, so two bundles could hand one name to two different classes.
export function withOwnClassNames(
  generator: LooseGenerator,
  entryName: string
): NonNullable<LooseGenerator> {
  const own = `[uniqueName]-${entryName.replace(/[^A-Za-z0-9_-]/g, '-')}-[id]-[local]`
  const named = {...generator}

  for (const type of ['css/auto', 'css/module']) {
    const configured = named[type]?.localIdentName

    // Any other name is one the author configured, theirs to keep unique.
    if (configured && configured !== DEV_CLASS_NAME) continue

    named[type] = {...named[type], localIdentName: own}
  }

  return named
}

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
  private readonly pageList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.includeList = options.includeList || {}
    this.pageList = options.pageList
  }

  public apply(compiler: Compiler): void {
    const manifestDir = path.dirname(this.manifestPath)
    const runtime = findRuntimeMainWorldEntries({
      includeList: this.includeList,
      pageList: this.pageList,
      manifestDir,
      projectPath: (compiler.options.context as string) || manifestDir
    })
    const entries = compiler.options.entry as Record<string, unknown>

    if (compiler.options.mode !== 'development') {
      // The copy shares its file with the isolated build of the same
      // compilation, and the layer is what makes it a module of its own.
      for (const {entryName, copyOf} of runtime) {
        const entry = entries?.[entryName]
        if (!copyOf || !entry || typeof entry !== 'object') continue

        entries[entryName] = {
          ...entry,
          layer: EXTENSIONJS_MAIN_WORLD_IMPORT_LAYER
        }
      }

      return
    }

    const groups: MainWorldEntry[] = [
      ...findMainWorldGroups(this.manifestPath, this.browser),
      ...runtime
    ]
    if (groups.length === 0) return

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

// In dev the parent names content bundles by their hash and leaves other
// entry names alone, so a child bundle asks the parent's own resolver.
function outputFilenameFor(compiler: Compiler, entryName: string): string {
  const filename = compiler.options.output?.filename

  if (typeof filename === 'function') {
    return (filename as (data: {chunk: {name: string}}) => string)({
      chunk: {name: entryName}
    })
  }

  return `${entryName}.js`
}

type ChildIssue = Compilation['errors'][number]

// The mark a child opens an issue with, colored or not.
// eslint-disable-next-line no-control-regex
const CHILD_FRAME = /^\s*(?:\u001b\[[0-9;]*m)*[×⚠](?:\u001b\[[0-9;]*m)*\s?/

// The parent holds no module of the child's graph, so it reports a forwarded
// issue with no file. A copy names it the way the parent names its own.
function namedForParent(compiler: Compiler, issue: ChildIssue): ChildIssue {
  const resource = (issue.module as {resource?: unknown} | undefined)?.resource

  if (typeof resource !== 'string' || !resource) return issue

  const relative = path
    .relative(compiler.context, resource)
    .split(path.sep)
    .join('/')
  const lines = String(issue.message).split('\n')
  // The copy is framed again, so the frame the child drew comes off first.
  const frame = CHILD_FRAME.exec(lines[0])
  const named = new compiler.rspack.WebpackError(
    frame
      ? lines
          .map((line, index) =>
            index === 0
              ? line.slice(frame[0].length)
              : line.replace(/^ {2}/, '')
          )
          .join('\n')
      : String(issue.message)
  ) as ChildIssue

  named.name = issue.name
  named.file = relative.startsWith('.') ? relative : `./${relative}`
  named.loc = issue.loc
  named.module = issue.module
  named.error = issue.error

  return named
}

async function compileGroup(
  compiler: Compiler,
  compilation: Compilation,
  group: MainWorldEntry
): Promise<void> {
  // AddScripts already names a deleted file and its field. Watched here, so
  // the group builds again once the file is written back.
  const gone = group.files.filter((file) => !fs.existsSync(file))

  if (gone.length > 0) {
    for (const file of gone) compilation.missingDependencies.add(file)

    return
  }

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
  markMainWorldCompiler(child)

  // A child writes its own files as it compiles, ahead of the steps that
  // drop some of them. The parent writes every file that is left.
  child.hooks.shouldEmit.tap(CompileMainWorldScripts.name, () => false)
  child.options.optimization = {
    ...child.options.optimization,
    splitChunks: false,
    runtimeChunk: false
  }

  child.options.module = {
    ...child.options.module,
    generator: withOwnClassNames(
      child.options.module.generator as LooseGenerator,
      group.entryName
    ) as typeof child.options.module.generator,
    // The browser loads the bundle as one file into the page, so a relative
    // import() is inlined rather than fetched from a chunk the page cannot see.
    parser: withEagerDynamicImports(
      child.options.module.parser as Record<string, unknown> | undefined
    ) as typeof child.options.module.parser,
    // Refresh signatures need the dev runtime the page entries carry.
    rules: withMainWorldBundle(
      withoutDevRefresh(child.options.module.rules as LooseRules)
    ) as typeof child.options.module.rules
  }

  const parentAssets = new Set(
    compilation.getAssets().map((asset) => asset.name)
  )

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
          compilation.errors.push(namedForParent(compiler, childError))
        }

        for (const childWarning of childCompilation.warnings) {
          compilation.warnings.push(namedForParent(compiler, childWarning))
        }

        // The bundler hands a failed child's files to the parent all the same,
        // so they are taken back: a broken bundle never ships.
        if (childCompilation.errors.length > 0) {
          for (const {name} of childCompilation.getAssets()) {
            if (!parentAssets.has(name)) compilation.deleteAsset(name)
          }
        }

        try {
          for (const dep of childCompilation.fileDependencies) {
            compilation.fileDependencies.add(dep)
          }

          for (const dep of childCompilation.contextDependencies) {
            compilation.contextDependencies.add(dep)
          }

          // An import that failed to resolve builds again when it returns.
          for (const dep of childCompilation.missingDependencies) {
            compilation.missingDependencies.add(dep)
          }
        } catch {
          // Ignore, watch registration is best-effort
        }
      }

      resolve()
    })
  })
}
