// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'

// The public root each compiler ships from, kept per compiler so the reload
// classifier can map a changed source to the dist path the copier gives it.
const publicRootsByCompiler = new WeakMap<object, string[]>()

export function rememberPublicRoots(compiler: object, roots: string[]): void {
  publicRootsByCompiler.set(
    compiler,
    roots.filter(Boolean).map((root) => path.resolve(root))
  )
}

export function publicRootsFor(compiler: object | undefined | null): string[] {
  if (!compiler) return []

  return publicRootsByCompiler.get(compiler) || []
}
