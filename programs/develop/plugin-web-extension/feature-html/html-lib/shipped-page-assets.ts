// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compilation, sources} from '@rspack/core'

// The files the page steps emitted themselves in one compilation, so a
// later build can tell which of its own copies it no longer ships.
const shippedByCompilation = new WeakMap<object, Set<string>>()

export function emitPageAsset(
  compilation: Compilation,
  name: string,
  source: sources.Source
): void {
  compilation.emitAsset(name, source)

  const shipped = shippedByCompilation.get(compilation) || new Set<string>()
  shipped.add(name.replace(/\\/g, '/'))
  shippedByCompilation.set(compilation, shipped)
}

export function shippedPageAssets(compilation: object): Set<string> {
  return shippedByCompilation.get(compilation) || new Set<string>()
}
