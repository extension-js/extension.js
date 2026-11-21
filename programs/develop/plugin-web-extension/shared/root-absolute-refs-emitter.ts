// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compilation, Compiler} from '@rspack/core'

// Emits the files a page or sheet names from the extension root. The HTML
// feature hands its emitter in, so the public copier never imports it.
export type RootAbsoluteRefsEmitter = (
  compilation: Compilation,
  context: string,
  publicDir: string,
  publicIsOff?: boolean,
  projectRoot?: string,
  pageSourceOf?: (assetName: string) => string | undefined
) => Promise<void>

const emitterByCompiler = new WeakMap<object, RootAbsoluteRefsEmitter>()

export function emitRootAbsoluteRefsWith(
  compiler: Compiler,
  emitter: RootAbsoluteRefsEmitter
): void {
  emitterByCompiler.set(compiler, emitter)
}

export function rootAbsoluteRefsEmitterFor(
  compiler: Compiler
): RootAbsoluteRefsEmitter | undefined {
  return emitterByCompiler.get(compiler)
}
