// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Configuration} from '@rspack/core'
import * as messages from './messages'
import {debugLine, isDebug} from './messaging'
import {
  type ChunkNameLike,
  isSurfaceLockedChunkName,
  type SplitChunksConfig
} from './split-chunks'

type ChunksOption = string | RegExp | ((chunk: ChunkNameLike) => boolean)

type CacheGroupLike = false | {chunks?: ChunksOption; [key: string]: unknown}

type SplitChunksLike = {
  chunks?: ChunksOption
  cacheGroups?: Record<string, CacheGroupLike>
  [key: string]: unknown
}

export interface NormalizedSplitChunks {
  config: Configuration
  // The option paths whose chunks selector was narrowed, in config order.
  narrowed: string[]
}

type LockedChunkName = (name: string | null | undefined) => boolean

// A user cache group that spans every chunk would also split the background
// and the content scripts, and those surfaces load exactly one file. Keep
// the user's intent for every page chunk, skip the single-file surfaces.
function narrowedSelector(
  option: 'all' | 'initial',
  isLocked: LockedChunkName
): (chunk: ChunkNameLike) => boolean {
  if (option === 'all') {
    return (chunk) => !isLocked(chunk.name)
  }

  return (chunk) =>
    (typeof chunk.canBeInitial === 'function' ? chunk.canBeInitial() : true) &&
    !isLocked(chunk.name)
}

function narrowChunks(
  chunks: ChunksOption | undefined,
  isLocked: LockedChunkName
): ((chunk: ChunkNameLike) => boolean) | undefined {
  if (chunks === 'all' || chunks === 'initial') {
    return narrowedSelector(chunks, isLocked)
  }

  return undefined
}

// A cache group's own chunks selector replaces the top-level one in rspack,
// so a user entry has to be kept out of every selector, not only the top.
function lockedChunkName(config: Configuration): LockedChunkName {
  const userEntries = new Set(userEntryNames(config))

  return (name) =>
    isSurfaceLockedChunkName(name) ||
    (typeof name === 'string' && userEntries.has(name))
}

// Never mutates the merged config: the returned config shares every
// untouched branch and only copies the objects it changes.
export function normalizeSplitChunks(
  config: Configuration
): NormalizedSplitChunks {
  const splitChunks = config.optimization?.splitChunks as
    | SplitChunksLike
    | false
    | undefined

  if (!splitChunks || typeof splitChunks !== 'object') {
    return {config, narrowed: []}
  }

  const isLocked = lockedChunkName(config)
  const narrowed: string[] = []
  const next: SplitChunksLike = {...splitChunks}

  const topLevel = narrowChunks(splitChunks.chunks, isLocked)

  if (topLevel) {
    next.chunks = topLevel
    narrowed.push('splitChunks.chunks')
  }

  if (splitChunks.cacheGroups && typeof splitChunks.cacheGroups === 'object') {
    const cacheGroups: Record<string, CacheGroupLike> = {}

    for (const [key, group] of Object.entries(splitChunks.cacheGroups)) {
      const groupSelector =
        group && typeof group === 'object'
          ? narrowChunks(group.chunks, isLocked)
          : undefined

      if (groupSelector && group && typeof group === 'object') {
        cacheGroups[key] = {...group, chunks: groupSelector}
        narrowed.push(`splitChunks.cacheGroups.${key}.chunks`)
      } else {
        cacheGroups[key] = group
      }
    }

    next.cacheGroups = cacheGroups
  }

  if (narrowed.length === 0) return {config, narrowed}

  return {
    config: {
      ...config,
      optimization: {
        ...config.optimization,
        splitChunks: next as unknown as SplitChunksConfig
      }
    },
    narrowed
  }
}

// The guard every compiler goes through right before rspack() sees the
// config. Says what it narrowed under EXTENSION_DEBUG so a user who set
// chunks: 'all' can find out why the background kept one file.
export function applySplitChunksGuard(config: Configuration): Configuration {
  const {config: next, narrowed} = normalizeSplitChunks(config)

  if (narrowed.length > 0 && isDebug()) {
    debugLine(messages.debugSplitChunksNarrowed(narrowed))
  }

  return keepRuntimeInline(keepUserEntriesWhole(next))
}

// A separate runtime file only reaches an HTML page. The background and the
// content scripts load one file, so a runtime split out of them never runs.
export function keepRuntimeInline(config: Configuration): Configuration {
  const runtimeChunk = config.optimization?.runtimeChunk

  if (!runtimeChunk) return config

  console.warn(messages.runtimeChunkKeptInline(runtimeChunk))

  return {
    ...config,
    optimization: {...config.optimization, runtimeChunk: false}
  }
}

// The engine starts from an empty entry map, so every name in the config at
// this point came from the user's extension.config.js. Nothing emits an HTML
// tag for those, so a shared chunk split out of one would never load: keep
// each of them one file.
export function userEntryNames(config: Configuration): string[] {
  const entry = config.entry

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []

  return Object.keys(entry)
}

export function keepUserEntriesWhole(config: Configuration): Configuration {
  const names = new Set(userEntryNames(config))
  const splitChunks = config.optimization?.splitChunks as
    | SplitChunksLike
    | false
    | undefined

  if (names.size === 0 || !splitChunks || typeof splitChunks !== 'object') {
    return config
  }

  const withoutUserEntries = (
    chunks: ChunksOption | undefined
  ): ((chunk: ChunkNameLike) => boolean) | undefined => {
    if (typeof chunks !== 'function') return undefined

    return (chunk) => !names.has(String(chunk.name)) && chunks(chunk)
  }

  let changed = false
  const next: SplitChunksLike = {...splitChunks}
  const topLevel = withoutUserEntries(splitChunks.chunks)

  if (topLevel) {
    next.chunks = topLevel
    changed = true
  }

  if (splitChunks.cacheGroups && typeof splitChunks.cacheGroups === 'object') {
    const cacheGroups: Record<string, CacheGroupLike> = {}

    for (const [key, group] of Object.entries(splitChunks.cacheGroups)) {
      const groupSelector =
        group && typeof group === 'object'
          ? withoutUserEntries(group.chunks)
          : undefined

      if (groupSelector && group && typeof group === 'object') {
        cacheGroups[key] = {...group, chunks: groupSelector}
        changed = true
      } else {
        cacheGroups[key] = group
      }
    }

    next.cacheGroups = cacheGroups
  }

  if (!changed) return config

  return {
    ...config,
    optimization: {
      ...config.optimization,
      splitChunks: next as unknown as SplitChunksConfig
    }
  }
}
