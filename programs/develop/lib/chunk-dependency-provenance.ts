// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export interface ChunkProvenance {
  // Packages sorted for a stable line, deduped across a chunk's modules.
  packages: string[]
  // True when every module in the file came from node_modules, which is the
  // only case where a finding cannot possibly be about the user's own source.
  onlyDependencies: boolean
}

interface ModuleLike {
  resource?: unknown
  identifier?: () => unknown
}

interface ChunkLike {
  files?: Iterable<string> | string[]
}

interface ChunkGraphLike {
  // `never` keeps the bundler's own `(chunk: Chunk) => ...` assignable here
  // under strictFunctionTypes, which `unknown` would reject.
  getChunkModulesIterable: (chunk: never) => Iterable<unknown>
}

export interface CompilationLike {
  chunks?: Iterable<unknown>
  chunkGraph?: ChunkGraphLike
}

// The last node_modules segment wins, which is what nesting means: a package
// vendored inside another is still the package the code belongs to.
export function packageNameFromPath(candidate: string): string | null {
  const normalized = candidate.replace(/\\/g, '/')
  const marker = '/node_modules/'
  const at = normalized.lastIndexOf(marker)

  if (at === -1) return null

  const rest = normalized.slice(at + marker.length)
  const segments = rest.split('/').filter(Boolean)

  if (segments.length === 0) return null

  // A scoped package spends two segments on its name.
  if (segments[0].startsWith('@')) {
    return segments.length > 1 ? `${segments[0]}/${segments[1]}` : null
  }

  // pnpm stores packages under a version directory, and its first segment is
  // the encoded name rather than a real one.
  if (segments[0].includes('@') && segments.length > 1) {
    return packageNameFromPath(`/node_modules/${segments.slice(1).join('/')}`)
  }

  return segments[0]
}

function isAbsoluteFilePath(candidate: string): boolean {
  return /^([a-zA-Z]:[\\/]|[\\/])/.test(candidate)
}

function pathOfModule(moduleObj: unknown): string | null {
  const candidate = moduleObj as ModuleLike

  if (typeof candidate?.resource === 'string' && candidate.resource) {
    return candidate.resource
  }

  if (typeof candidate?.identifier === 'function') {
    const identifier = candidate.identifier()

    if (typeof identifier === 'string' && identifier) return identifier
  }

  return null
}

// A store check reports findings against emitted files, and an emitted file
// carries whatever the bundler put in it, under a name we chose.
export function collectChunkDependencyProvenance(
  compilation: CompilationLike | null | undefined
): Map<string, ChunkProvenance> {
  const provenance = new Map<string, ChunkProvenance>()
  const chunkGraph = compilation?.chunkGraph
  const chunks = compilation?.chunks

  if (!chunkGraph?.getChunkModulesIterable || !chunks) return provenance

  for (const chunk of chunks) {
    const files = (chunk as ChunkLike)?.files
    if (!files) continue

    let modules: unknown[] = []

    try {
      modules = Array.from(chunkGraph.getChunkModulesIterable(chunk as never))
    } catch {
      continue
    }

    const packages = new Set<string>()
    let counted = 0
    let fromDependencies = 0

    for (const moduleObj of modules) {
      const modulePath = pathOfModule(moduleObj)
      if (!modulePath) continue

      // Runtime and other synthetic modules identify themselves with a
      // relative label like `webpack/runtime/...` rather than a real file, so
      // counting them would make a pure vendor chunk look mixed.
      if (!isAbsoluteFilePath(modulePath)) continue

      counted += 1

      const packageName = packageNameFromPath(modulePath)

      if (packageName) {
        fromDependencies += 1
        packages.add(packageName)
      }
    }

    if (packages.size === 0) continue

    const entry: ChunkProvenance = {
      packages: [...packages].sort(),
      onlyDependencies: counted > 0 && fromDependencies === counted
    }

    for (const file of files) {
      if (typeof file !== 'string' || !file.endsWith('.js')) continue

      const existing = provenance.get(file)

      if (!existing) {
        provenance.set(file, entry)

        continue
      }

      // Two chunks can write the same file name, so the merged view keeps
      // every package and stays "only dependencies" only if both were.
      provenance.set(file, {
        packages: [
          ...new Set([...existing.packages, ...entry.packages])
        ].sort(),
        onlyDependencies: existing.onlyDependencies && entry.onlyDependencies
      })
    }
  }

  return provenance
}
