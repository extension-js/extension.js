// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import {Compilation, type Compiler, WebpackError} from '@rspack/core'
import {classifyEntrySurface} from '../../../lib/split-chunks'
import type {DevOptions, PluginInterface} from '../../../types'
import {scannableSourcePath} from '../../feature-manifest/steps/apply-dev-defaults-lib/dev-injected-hosts'
import {readProjectSource} from '../../feature-manifest/steps/apply-dev-defaults-lib/emitted-evidence'
import {classicConcatFiles} from '../../shared/classic-concat'
import * as messages from '../messages'
import {
  constantFacts,
  loadTimeConstants
} from '../scripts-lib/load-time-constants'

interface SourceModule {
  resource?: string
  modules?: Iterable<SourceModule>
  originalSource?: () => {source(): string | Buffer} | null
}

interface Read {
  name: string
  file: string
}

function moduleText(module: SourceModule): string | undefined {
  try {
    const raw = module.originalSource?.()?.source()
    if (raw === undefined || raw === null) return undefined

    return typeof raw === 'string' ? raw : raw.toString('utf-8')
  } catch {
    return undefined
  }
}

// A concatenated classic group is one module built from several files, so
// the file named is the first one in the group that spells the constant.
function fileSpelling(files: string[], name: string): string {
  const spelled = new RegExp(`(?<![\\w$.])${name}(?![\\w$])`)

  for (const file of files) {
    const text = readProjectSource(file)
    if (text !== undefined && spelled.test(text)) return file
  }

  return files[0]
}

// The constants an entry is certain to read as it loads and that none of
// its own modules provide, each with the file that reads it.
export function missingConstantsOf(
  modules: Iterable<SourceModule>,
  isProvided: (name: string) => boolean
): Read[] {
  const reads: Read[] = []
  const provided = new Set<string>()
  let dynamic = false

  for (const outer of modules) {
    for (const module of outer.modules ? [...outer.modules] : [outer]) {
      const resource = scannableSourcePath(module.resource)
      if (!resource) continue

      const text = moduleText(module)
      if (text === undefined) continue

      const facts = loadTimeConstants(text)
      dynamic ||= facts.dynamic

      for (const name of facts.provided) provided.add(name)

      const concat = classicConcatFiles(module.resource)

      for (const file of concat) {
        const raw = readProjectSource(file)
        if (raw === undefined) continue

        const own = constantFacts(raw)
        dynamic ||= own.dynamic

        for (const name of own.provided) provided.add(name)
      }

      for (const name of facts.reads) {
        reads.push({
          name,
          file: concat.length ? fileSpelling(concat, name) : resource
        })
      }
    }
  }

  if (dynamic) return []

  return reads.filter(
    (read) => !provided.has(read.name) && !isProvided(read.name)
  )
}

// A constant the author meant to `define` and did not reads as a bare global
// in the worker, which throws before the first listener is registered. The
// build is green, so the name is said here. Only a spelling like a build
// constant is judged, only in a background entry, and only when the read is
// unconditional, so a guarded or optional read never warns.
export class WarnMissingBuildConstants {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  public readonly devSession?: boolean
  public readonly define: Record<string, unknown>

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.devSession = options.devSession
    this.define = options.define || {}
  }

  apply(compiler: Compiler) {
    if (!compiler?.hooks?.thisCompilation) return

    if (compiler.options.mode === 'development' && this.devSession !== false) {
      return
    }

    compiler.hooks.thisCompilation.tap(
      'scripts:warn-missing-build-constants',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'scripts:warn-missing-build-constants',
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 100
          },
          () => {
            if (compilation.errors.length > 0) return

            try {
              this.warn(compilation)
            } catch {
              // Diagnostics only, never fail the compile over the scan
            }
          }
        )
      }
    )
  }

  private warn(compilation: Compilation) {
    const isProvided = (name: string) => name in this.define
    const manifestDir = path.dirname(this.manifestPath)

    for (const [entryName, entrypoint] of compilation.entrypoints) {
      if (classifyEntrySurface(entryName) !== 'background') continue

      const files = new Set<string>()
      const modules: SourceModule[] = []

      for (const chunk of entrypoint.chunks) {
        for (const file of chunk.files) files.add(file)

        for (const module of compilation.chunkGraph.getChunkModulesIterable(
          chunk
        )) {
          modules.push(module as SourceModule)
        }
      }

      const emitted = [...files]
        .filter((file) => /\.[cm]?js$/.test(file))
        .map((file) => {
          const source = compilation.getAsset(file)?.source.source()

          return typeof source === 'string'
            ? source
            : (source?.toString('utf-8') ?? '')
        })
        .join('\n')

      const reported = new Set<string>()

      for (const read of missingConstantsOf(modules, isProvided)) {
        const key = `${read.file}\0${read.name}`
        if (reported.has(key)) continue

        // A read the bundler dropped or replaced is not one the worker makes.
        const survives = new RegExp(`(?<![\\w$.])${read.name}(?![\\w$])`)
        if (!survives.test(emitted)) continue

        reported.add(key)

        const relative = path
          .relative(manifestDir, read.file)
          .split(path.sep)
          .join('/')
        const warning = new WebpackError(
          messages.buildConstantNeverDefined(relative, read.name, entryName)
        ) as Error & {file?: string}
        warning.name = 'MissingBuildConstantWarning'
        warning.file = relative
        compilation.warnings.push(warning)
      }
    }
  }
}
