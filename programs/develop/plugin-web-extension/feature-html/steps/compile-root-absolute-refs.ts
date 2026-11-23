// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance
import * as fs from 'node:fs'
import type {Compilation} from '@rspack/core'
import {isChildBundleChunkName} from '../../../lib/child-bundle-chunk'
import {sayPendingDiagnostics} from '../../../lib/pending-diagnostics'
import {
  type CompileRequest,
  compileRuntimeLoadedFiles
} from '../../feature-scripts/steps/trace-runtime-loaded-files'

type ChildAsset = ReturnType<Compilation['getAssets']>[number]

// What one child compile gave the build, and every path it read or looked
// for with what was there, so a rebuild that changed none of them reuses it.
interface KeptCompile {
  request: CompileRequest
  assets: Array<Pick<ChildAsset, 'name' | 'source' | 'info'>>
  fileDependencies: string[]
  inputs: Map<string, string>
}

const keptByCompiler = new WeakMap<object, Map<string, KeptCompile>>()

export interface RootRefCompiles {
  // Resolves with how many files the requests put in the build.
  compile(requests: CompileRequest[]): Promise<number>
  // Drops what is kept for a file this build did not ask for.
  forgetUnasked(): void
}

// A file a root-absolute ref compiles is built in a child of its own, on
// every rebuild. A watch session keeps the result while its inputs hold.
export function rootRefCompilesFor(compilation: Compilation): RootRefCompiles {
  const {compiler} = compilation

  if (!compiler?.watchMode || !Array.isArray(compilation.children)) {
    return {
      compile: async (requests) =>
        (await compileRuntimeLoadedFiles(compilation, compiler, requests))
          .length,
      forgetUnasked: () => {}
    }
  }

  const kept = keptByCompiler.get(compiler) ?? new Map<string, KeptCompile>()
  const asked = new Set<string>()

  keptByCompiler.set(compiler, kept)

  return {
    async compile(requests) {
      let emitted = 0

      // One at a time and in order, the way the child compiles run.
      for (const request of requests) {
        const earlier = kept.get(request.emitPath)

        asked.add(request.emitPath)

        if (
          earlier &&
          isSameRequest(earlier.request, request) &&
          stillHolds(earlier, compilation)
        ) {
          replay(earlier, compilation)
          emitted += earlier.assets.length
          continue
        }

        kept.delete(request.emitPath)

        const {children} = compilation
        const childrenBefore = children.length
        const errorsBefore = compilation.errors.length
        const warningsBefore = compilation.warnings.length
        const appeared = await compileRuntimeLoadedFiles(
          compilation,
          compiler,
          [request]
        )

        emitted += appeared.length

        // A compile that said something says it again on every rebuild.
        if (
          children.length !== childrenBefore + 1 ||
          compilation.errors.length !== errorsBefore ||
          compilation.warnings.length !== warningsBefore
        ) {
          continue
        }

        const result = resultToKeep(
          request,
          children[childrenBefore],
          appeared,
          compilation
        )
        if (result) kept.set(request.emitPath, result)
      }

      return emitted
    },
    forgetUnasked() {
      for (const emitPath of kept.keys()) {
        if (!asked.has(emitPath)) kept.delete(emitPath)
      }
    }
  }
}

function isSameRequest(a: CompileRequest, b: CompileRequest): boolean {
  return (
    a.sourcePath === b.sourcePath &&
    a.emitPath === b.emitPath &&
    a.format === b.format &&
    a.context === b.context
  )
}

function resultToKeep(
  request: CompileRequest,
  child: Compilation,
  appeared: string[],
  compilation: Compilation
): KeptCompile | undefined {
  try {
    // A later step reads the sources in this child's chunks, so it runs.
    for (const chunk of child.chunks) {
      if (isChildBundleChunkName(String(chunk?.name || ''))) return undefined
    }

    // A folder the child read is not followed here, so it compiles again.
    for (const _folder of child.contextDependencies) return undefined

    const fresh = new Set(appeared)
    const assets: KeptCompile['assets'] = []

    for (const {name, source, info} of child.getAssets()) {
      if (fresh.has(name)) {
        assets.push({name, source, info})
      } else if (compilation.getAsset(name)) {
        // The child wrote over a file another step had put in the build.
        return undefined
      }
    }

    if (assets.length !== appeared.length) return undefined

    const fileDependencies = [...child.fileDependencies]
    const inputs = new Map<string, string>()

    for (const file of fileDependencies) inputs.set(file, stateOf(file))

    for (const file of child.missingDependencies) {
      inputs.set(file, stateOf(file))
    }

    return {request, assets, fileDependencies, inputs}
  } catch {
    return undefined
  }
}

function stillHolds(earlier: KeptCompile, compilation: Compilation): boolean {
  const {modifiedFiles, removedFiles} = compilation.compiler

  for (const [file, state] of earlier.inputs) {
    // The watcher names a file written while the last compile read it.
    if (modifiedFiles?.has(file) || removedFiles?.has(file)) return false
    if (stateOf(file) !== state) return false
  }

  return earlier.assets.every(({name}) => !compilation.getAsset(name))
}

function replay(earlier: KeptCompile, compilation: Compilation): void {
  sayPendingDiagnostics(compilation.compiler, compilation)

  for (const {name, source, info} of earlier.assets) {
    compilation.emitAsset(name, source, info)
  }

  try {
    for (const file of earlier.fileDependencies) {
      compilation.fileDependencies.add(file)
    }
  } catch {
    // Ignore, watch registration is best-effort
  }
}

function stateOf(file: string): string {
  try {
    const stat = fs.statSync(file, {throwIfNoEntry: false})

    return stat ? `${stat.isFile()}:${stat.size}:${stat.mtimeMs}` : ''
  } catch {
    return ''
  }
}
