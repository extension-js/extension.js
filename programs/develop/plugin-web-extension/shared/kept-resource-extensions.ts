// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compilation, Compiler} from '@rspack/core'

// Files a page may still ask for though this compile did not emit them,
// as paths in the output. The manifest keeps them web accessible.
export type KeptResourcesReader = (compilation: Compilation) => string[]

const readersByCompiler = new WeakMap<object, KeptResourcesReader[]>()

export function keepResourcesReachable(
  compiler: Compiler,
  reader: KeptResourcesReader
): void {
  const readers = readersByCompiler.get(compiler) ?? []

  if (!readers.includes(reader)) readers.push(reader)

  readersByCompiler.set(compiler, readers)
}

export function resourcesKeptReachable(compilation: Compilation): string[] {
  const compiler = (compilation as {compiler?: object}).compiler
  const readers = (compiler && readersByCompiler.get(compiler)) || []

  return readers.flatMap((reader) => reader(compilation))
}
