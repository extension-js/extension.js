// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Configuration} from '@rspack/core'
import * as messages from './messages'
import {isDebug} from './messaging'
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

// A user cache group that spans every chunk would also split the background
// and the content scripts, and those surfaces load exactly one file. Keep
// the user's intent for every page chunk, skip the single-file surfaces.
function narrowedSelector(
  option: 'all' | 'initial'
): (chunk: ChunkNameLike) => boolean {
  if (option === 'all') {
    return (chunk) => !isSurfaceLockedChunkName(chunk.name)
  }

  return (chunk) =>
    (typeof chunk.canBeInitial === 'function' ? chunk.canBeInitial() : true) &&
    !isSurfaceLockedChunkName(chunk.name)
}

function narrowChunks(
  chunks: ChunksOption | undefined
): ((chunk: ChunkNameLike) => boolean) | undefined {
  if (chunks === 'all' || chunks === 'initial') return narrowedSelector(chunks)

  return undefined
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

  const narrowed: string[] = []
  const next: SplitChunksLike = {...splitChunks}

  const topLevel = narrowChunks(splitChunks.chunks)

  if (topLevel) {
    next.chunks = topLevel
    narrowed.push('splitChunks.chunks')
  }

  if (splitChunks.cacheGroups && typeof splitChunks.cacheGroups === 'object') {
    const cacheGroups: Record<string, CacheGroupLike> = {}

    for (const [key, group] of Object.entries(splitChunks.cacheGroups)) {
      const groupSelector =
        group && typeof group === 'object'
          ? narrowChunks(group.chunks)
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
    console.log(messages.debugSplitChunksNarrowed(narrowed))
  }

  return keepUserEntriesWhole(next)
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

  const selector = splitChunks.chunks

  if (typeof selector !== 'function') return config

  const chunks = (chunk: ChunkNameLike) =>
    !names.has(String(chunk.name)) && selector(chunk)

  return {
    ...config,
    optimization: {
      ...config.optimization,
      splitChunks: {...splitChunks, chunks} as unknown as SplitChunksConfig
    }
  }
}
