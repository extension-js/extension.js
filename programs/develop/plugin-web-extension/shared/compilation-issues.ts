// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compilation, Compiler} from '@rspack/core'

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

export function reportToCompilation(
  compilation: Compilation,
  compiler: Compiler,
  message: string,
  type: IssueType = 'error',
  file?: string
) {
  const issue = createIssue(compiler, message, type) as Error & {
    file?: string
  }
  if (file) issue.file = file
  const bucket = type === 'warning' ? 'warnings' : 'errors'
  compilation[bucket] ||= []
  // de-dupe by file + message text
  const existing = compilation[bucket] as Array<Error & {file?: string}>
  const already = existing.some((e) => {
    return (
      (e?.file || '') === (issue.file || '') &&
      String(e?.message) === String(issue.message)
    )
  })
  if (already) return
  compilation[bucket].push(issue)
}
