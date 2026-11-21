// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler} from '@rspack/core'

// The background entries the chunk loader can answer a content script from.
export interface ChunkLoadingBackgroundEntries {
  pageEntry?: string
  serviceWorkerEntry?: string
}

// What a plugin applied before the chunk loading target may change about it.
interface ChunkLoadingTargetExtension {
  // Turns on the background side of the message fallback, which injects a
  // chunk a content script could not import, in the background returned.
  // It gets the one the manifest names and is read when the target applies.
  fallbackBackground(
    authored: ChunkLoadingBackgroundEntries
  ): ChunkLoadingBackgroundEntries
}

const extensionsByCompiler = new WeakMap<
  Compiler,
  ChunkLoadingTargetExtension[]
>()

export function chunkLoadingTargetExtensionsFor(
  compiler: Compiler
): readonly ChunkLoadingTargetExtension[] {
  return extensionsByCompiler.get(compiler) ?? []
}

export function extendChunkLoadingTarget(
  compiler: Compiler,
  extension: ChunkLoadingTargetExtension
): void {
  const extensions = extensionsByCompiler.get(compiler) ?? []

  if (!extensions.includes(extension)) extensions.push(extension)

  extensionsByCompiler.set(compiler, extensions)
}
