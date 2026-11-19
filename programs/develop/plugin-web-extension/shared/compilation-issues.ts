// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compilation, Compiler} from '@rspack/core'
import {toMachineText} from '../../lib/machine-text'

export type IssueType = 'error' | 'warning'

export function createIssue(
  compiler: Compiler,
  message: string,
  type: IssueType = 'error'
) {
  const ErrorCtor = compiler?.rspack?.WebpackError || Error
  const issue = new ErrorCtor(message) as Error & {name?: string}
  issue.name = type === 'warning' ? 'ExtensionWarning' : 'ExtensionError'

  return issue
}

// The bundler hands back each pushed issue framed (glyph, indent, newline),
// so two issues match by the file and text the printed block shows.
function printedIdentity(issue: {file?: unknown; message?: unknown}): string {
  return `${String(issue?.file || '')}\n${toMachineText(issue?.message)}`
}

export function reportToCompilation(
  compilation: Compilation,
  compiler: Compiler,
  message: string,
  type: IssueType = 'error',
  file?: string,
  name?: string
) {
  const issue = createIssue(compiler, message, type) as Error & {
    file?: string
  }
  if (file) issue.file = file
  if (name) issue.name = name

  const bucket = type === 'warning' ? 'warnings' : 'errors'
  compilation[bucket] ||= []
  // The bundler's list proxies only some array methods, and `some` reads an
  // empty backing array, so the check walks a copy taken by iteration.
  const existing = Array.from(compilation[bucket] as Array<Error>)
  const key = printedIdentity(issue)
  if (existing.some((e) => printedIdentity(e) === key)) return

  compilation[bucket].push(issue)
}
