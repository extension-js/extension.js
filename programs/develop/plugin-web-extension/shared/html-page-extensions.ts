// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler} from '@rspack/core'

// A page the build compiles: the entry it declared, the file it was read
// from and the script files that file names, as absolute paths.
export interface HtmlPage {
  entry: string
  file: string
  scripts: string[]
}

// What a plugin applied before the pages are declared may add to them.
interface HtmlPagesExtension {
  // Called once, as soon as every page has its entry in the config.
  pagesDeclared(compiler: Compiler, pages: readonly HtmlPage[]): void
}

const extensionsByCompiler = new WeakMap<Compiler, HtmlPagesExtension[]>()

export function htmlPagesExtensionsFor(
  compiler: Compiler
): readonly HtmlPagesExtension[] {
  return extensionsByCompiler.get(compiler) ?? []
}

export function extendHtmlPages(
  compiler: Compiler,
  extension: HtmlPagesExtension
): void {
  const extensions = extensionsByCompiler.get(compiler) ?? []

  if (!extensions.includes(extension)) extensions.push(extension)

  extensionsByCompiler.set(compiler, extensions)
}
