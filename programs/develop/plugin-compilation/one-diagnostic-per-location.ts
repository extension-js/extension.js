//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compilation, Compiler} from '@rspack/core'

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

type Diagnostic = {
  message?: unknown
  module?: {resource?: unknown} | null
  loc?: unknown
}

// The file, the place in it and the text, with no layer in the key. A
// diagnostic that names no file has no location to share, so it has no key.
function locationKey(diagnostic: Diagnostic): string | undefined {
  const resource = String(diagnostic?.module?.resource || '')
  if (!resource) return undefined

  let loc = ''

  try {
    loc = JSON.stringify(diagnostic.loc ?? '')
  } catch {
    loc = ''
  }

  const message = String(diagnostic.message || '').replace(ANSI, '')

  return `${resource}\n${loc}\n${message}`
}

export function dropRepeatedDiagnostics(diagnostics: Diagnostic[]): number {
  const seen = new Set<string>()
  let dropped = 0

  for (let index = 0; index < diagnostics.length; index++) {
    const key = locationKey(diagnostics[index])
    if (!key) continue

    if (seen.has(key)) {
      diagnostics.splice(index, 1)
      index--
      dropped++
      continue
    }

    seen.add(key)
  }

  return dropped
}

// A file two layers import is compiled once per layer (a content script and
// the background share no module), and each copy reports the same finding.
export class OneDiagnosticPerLocationPlugin {
  apply(compiler: Compiler) {
    compiler.hooks.afterCompile.tap(
      {name: OneDiagnosticPerLocationPlugin.name, stage: 1000},
      (compilation: Compilation) => {
        dropRepeatedDiagnostics(compilation.errors as unknown as Diagnostic[])
        dropRepeatedDiagnostics(compilation.warnings as unknown as Diagnostic[])
      }
    )
  }
}
