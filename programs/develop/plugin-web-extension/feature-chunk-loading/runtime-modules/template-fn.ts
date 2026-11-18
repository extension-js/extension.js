// ██╗      ██████╗  █████╗ ██████╗ ███████╗██████╗
// ██║     ██╔═══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ██║     ██║   ██║███████║██║  ██║█████╗  ██████╔╝
// ██║     ██║   ██║██╔══██║██║  ██║██╔══╝  ██╔══██╗
// ███████╗╚██████╔╝██║  ██║██████╔╝███████╗██║  ██║
// ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compilation} from '@rspack/core'

// Derived from webpack-target-webextension (MIT, Copyright 2020 CRIMX).
// The license notice is in the README of this folder.

// Writes a function in the syntax the output environment accepts.
export function TemplateFn(compilation: Compilation) {
  return {
    f: (args: string, body: string | string[]): string =>
      compilation.runtimeTemplate.basicFunction(args, body)
  }
}
