// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compilation, Compiler} from '@rspack/core'
import type {Manifest} from '../../types'

// What a plugin applied after the manifest feature may change in the
// manifest it resolved, before any later step reads it.
export interface ManifestExtension {
  // Called on every compile with the manifest whose paths are resolved.
  manifestResolved(compilation: Compilation, manifest: Manifest): Manifest
}

const extensionsByCompiler = new WeakMap<Compiler, ManifestExtension[]>()

export function manifestExtensionsFor(
  compiler: Compiler
): readonly ManifestExtension[] {
  return extensionsByCompiler.get(compiler) ?? []
}

export function extendManifest(
  compiler: Compiler,
  extension: ManifestExtension
): void {
  const extensions = extensionsByCompiler.get(compiler) ?? []

  if (!extensions.includes(extension)) extensions.push(extension)

  extensionsByCompiler.set(compiler, extensions)
}
