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
import type {CompileRequest} from '../steps/trace-runtime-loaded-files'

type ChildAsset = ReturnType<Compilation['getAssets']>[number]

// What one child compile gave the build, and every path it read or looked
// for with what was there, so a rebuild that changed none of them reuses it.
interface KeptCompile {
  request: CompileRequest
  assets: Array<Pick<ChildAsset, 'name' | 'source' | 'info'>>
  fileDependencies: string[]
  missingDependencies: string[]
  inputs: Map<string, string>
}

interface KeptBySession {
  kept: Map<string, KeptCompile>
  // The files the build in `askedIn` asked for, which the next one keeps.
  asked: Set<string>
  askedIn?: Compilation
}

const keptByCompiler = new WeakMap<object, KeptBySession>()

export interface KeptChildCompiles {
  // Puts an earlier compile of the request back in the build when it holds.
  replay(request: CompileRequest): boolean
  // Keeps a compile that just ran and put `appeared` in the build.
  keep(request: CompileRequest, child: Compilation, appeared: string[]): void
}

// A runtime-loaded file is built in a child of its own, on every rebuild.
// A watch session keeps the result while its inputs hold, a single build not.
export function keptChildCompilesFor(
  compilation: Compilation
): KeptChildCompiles | undefined {
  const {compiler} = compilation

  if (!compiler?.watchMode) return undefined

  const session = keptByCompiler.get(compiler) ?? {
    kept: new Map<string, KeptCompile>(),
    asked: new Set<string>()
  }

  keptByCompiler.set(compiler, session)

  // A new build: what the last one did not ask for is no longer kept.
  if (session.askedIn !== compilation) {
    for (const emitPath of session.kept.keys()) {
      if (!session.asked.has(emitPath)) session.kept.delete(emitPath)
    }

    session.asked = new Set<string>()
    session.askedIn = compilation
  }

  const {kept, asked} = session

  return {
    replay(request) {
      const earlier = kept.get(request.emitPath)

      asked.add(request.emitPath)

      if (
        earlier &&
        isSameRequest(earlier.request, request) &&
        stillHolds(earlier, compilation)
      ) {
        putBack(earlier, compilation)

        return true
      }

      kept.delete(request.emitPath)

      return false
    },
    keep(request, child, appeared) {
      const result = resultToKeep(request, child, appeared, compilation)

      if (result) kept.set(request.emitPath, result)
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
    const missingDependencies = [...child.missingDependencies]
    const inputs = new Map<string, string>()

    for (const file of fileDependencies) inputs.set(file, stateOf(file))

    for (const file of missingDependencies) inputs.set(file, stateOf(file))

    return {request, assets, fileDependencies, missingDependencies, inputs}
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

function putBack(earlier: KeptCompile, compilation: Compilation): void {
  sayPendingDiagnostics(compilation.compiler, compilation)

  for (const {name, source, info} of earlier.assets) {
    compilation.emitAsset(name, source, info)
  }

  watchWhatChildRead(compilation, earlier)
}

// The build watches what a child read, and what it looked for and missed,
// so a save or a file that appears there compiles the child again.
export function watchWhatChildRead(
  compilation: Compilation,
  child: {
    fileDependencies: Iterable<string>
    missingDependencies: Iterable<string>
  }
): void {
  try {
    for (const file of child.fileDependencies) {
      compilation.fileDependencies.add(file)
    }

    for (const file of child.missingDependencies) {
      compilation.missingDependencies.add(file)
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
