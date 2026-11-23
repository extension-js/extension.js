//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance
import type {Compilation, Compiler} from '@rspack/core'

type SayPending = (compilation: Compilation) => void

const pendingByCompiler = new WeakMap<object, SayPending[]>()

// A plugin that reports at the end of a compile also reports at the end of
// each child compile. A step that skips a child asks for that report here.
export function sayPendingAfterCompile(
  compiler: Compiler,
  name: string,
  say: SayPending
): void {
  compiler.hooks.afterCompile.tap(name, say)

  const pending = pendingByCompiler.get(compiler) ?? []

  pending.push(say)
  pendingByCompiler.set(compiler, pending)
}

export function sayPendingDiagnostics(
  compiler: Compiler,
  compilation: Compilation
): void {
  for (const say of pendingByCompiler.get(compiler) ?? []) say(compilation)
}
