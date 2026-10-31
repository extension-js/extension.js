// ██████╗ ███████╗██████╗ ███████╗      ██████╗ ██╗   ██╗██████╗  ██████╗ ███████╗████████╗███████╗
// ██╔══██╗██╔════╝██╔══██╗██╔════╝      ██╔══██╗██║   ██║██╔══██╗██╔════╝ ██╔════╝╚══██╔══╝██╔════╝
// ██████╔╝█████╗  ██████╔╝█████╗  █████╗██████╔╝██║   ██║██║  ██║██║  ███╗█████╗     ██║   ███████╗
// ██╔═══╝ ██╔══╝  ██╔══██╗██╔══╝  ╚════╝██╔══██╗██║   ██║██║  ██║██║   ██║██╔══╝     ██║   ╚════██║
// ██║     ███████╗██║  ██║██║          ██████╔╝╚██████╔╝██████╔╝╚██████╔╝███████╗   ██║   ███████║
// ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝          ╚═════╝  ╚═════╝ ╚═════╝  ╚═════╝ ╚══════╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compilation} from '@rspack/core'
import {classifyEntrySurface, type EntrySurface} from '../lib/split-chunks'

type ChunkLike = {
  name?: string | null
  id?: string | number | null
  runtime?: Iterable<string> | string
  files?: Iterable<string>
  auxiliaryFiles?: Iterable<string>
  groupsIterable?: Iterable<{
    origins?: Iterable<{module?: object | null}>
  }>
}

type ModuleLike = {
  identifier?: () => string
  modules?: Iterable<ModuleLike>
}

export type AssetReferrers = ReadonlyMap<string, ReadonlySet<EntrySurface>>

function toArray<T>(value: Iterable<T> | T | null | undefined): T[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'string') return [value as T]
  if (Array.isArray(value)) return value

  return typeof (value as Iterable<T>)[Symbol.iterator] === 'function'
    ? Array.from(value as Iterable<T>)
    : [value as T]
}

// The chunk graph can hand back a fresh wrapper for the same chunk, so
// owners are kept by name or id rather than by object identity.
function keyOf(chunk: ChunkLike): unknown {
  const name = String(chunk?.name || '')
  if (name) return `name:${name}`

  const id = chunk?.id

  return id === null || id === undefined ? chunk : `id:${String(id)}`
}

function identifierOf(module: ModuleLike | null | undefined): string {
  try {
    return module?.identifier ? String(module.identifier()) : ''
  } catch {
    return ''
  }
}

type ChunkGraphLike = {
  getModuleChunksIterable?: (module: never) => Iterable<ChunkLike>
  getChunkModulesIterable?: (chunk: never) => Iterable<ModuleLike>
}

// Which surfaces reach each emitted file. A named chunk is its own entry, a
// lazy chunk runs under its entry's runtime, and a worker chunk names the
// module that created it, so it inherits the owners of that module's chunks.
// A production build concatenates that module into its entry, and the chunk
// graph no longer answers for it, so every chunk's modules, inner ones
// included, are indexed by identifier as the fallback.
export function collectAssetReferrers(
  compilation: Pick<Compilation, 'chunkGraph'> & {chunks?: Iterable<ChunkLike>}
): AssetReferrers {
  const chunks = toArray<ChunkLike>(compilation.chunks)
  const chunkGraph = compilation.chunkGraph as ChunkGraphLike | undefined
  const entryNames = new Set(
    chunks.map((chunk) => String(chunk?.name || '')).filter(Boolean)
  )
  const ownersByChunk = new Map<unknown, Set<string>>()

  for (const chunk of chunks) {
    const name = String(chunk?.name || '')
    if (name) ownersByChunk.set(keyOf(chunk), new Set([name]))
  }

  const chunkKeysByModule = new Map<string, Set<unknown>>()

  const indexModule = (module: ModuleLike, key: unknown) => {
    const id = identifierOf(module)
    if (!id) return

    const known = chunkKeysByModule.get(id) || new Set<unknown>()
    known.add(key)
    chunkKeysByModule.set(id, known)
  }

  for (const chunk of chunks) {
    let modules: ModuleLike[] = []

    try {
      modules = toArray(chunkGraph?.getChunkModulesIterable?.(chunk as never))
    } catch {
      modules = []
    }

    for (const module of modules) {
      indexModule(module, keyOf(chunk))

      let inner: ModuleLike[] = []

      try {
        inner = toArray(module?.modules)
      } catch {
        inner = []
      }

      for (const innerModule of inner) indexModule(innerModule, keyOf(chunk))
    }
  }

  const chunkKeysOfModule = (module: ModuleLike): Set<unknown> => {
    const keys = new Set<unknown>()

    try {
      for (const chunk of toArray(
        chunkGraph?.getModuleChunksIterable?.(module as never)
      )) {
        keys.add(keyOf(chunk))
      }
    } catch {
      // The graph does not answer for a module it concatenated away
    }

    for (const key of chunkKeysByModule.get(identifierOf(module)) || []) {
      keys.add(key)
    }

    return keys
  }

  const ownersOf = (chunk: ChunkLike): Set<string> => {
    const owners = new Set<string>()

    for (const runtime of toArray<string>(chunk.runtime)) {
      if (entryNames.has(runtime)) owners.add(runtime)
    }

    if (owners.size > 0) return owners

    for (const group of toArray(chunk.groupsIterable)) {
      for (const origin of toArray(group.origins)) {
        if (!origin?.module) continue

        for (const key of chunkKeysOfModule(origin.module as ModuleLike)) {
          for (const owner of ownersByChunk.get(key) || []) owners.add(owner)
        }
      }
    }

    return owners
  }

  // A worker made from another nameless chunk resolves once that one has
  // owners, so settle in a few passes.
  for (let pass = 0; pass < 3; pass++) {
    let settled = true

    for (const chunk of chunks) {
      if (ownersByChunk.has(keyOf(chunk))) continue

      const owners = ownersOf(chunk)
      if (owners.size === 0) continue

      ownersByChunk.set(keyOf(chunk), owners)
      settled = false
    }

    if (settled) break
  }

  const referrers = new Map<string, Set<EntrySurface>>()

  for (const chunk of chunks) {
    const owners = ownersByChunk.get(keyOf(chunk))
    if (!owners) continue

    const surfaces = [...owners].map((owner) => classifyEntrySurface(owner))
    const files = [...toArray(chunk.files), ...toArray(chunk.auxiliaryFiles)]

    for (const file of files) {
      const name = String(file || '').replace(/\\/g, '/')
      if (!name) continue

      const known = referrers.get(name) || new Set<EntrySurface>()
      for (const surface of surfaces) known.add(surface)
      referrers.set(name, known)
    }
  }

  return referrers
}
