// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {MAX_SUMMARY_WARNINGS} from './build-summary'
import type {Diagnostic} from './messaging'

export interface CompilationLike {
  errors?: unknown[]
  warnings?: unknown[]
  compiler?: {context?: string}
}

interface CompilerIssue {
  message?: unknown
  file?: unknown
  loc?: {start?: {line?: unknown; column?: unknown}} | null
  module?: {resource?: unknown} | null
  name?: unknown
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

// The bundler renders a glyph and a gutter in front of its message text,
// which a consumer of a structured field should never have to peel off.
function plainMessage(raw: unknown): string {
  return String(raw ?? '')
    .replace(ANSI_PATTERN, '')
    .split('\n')
    .map((line, index) =>
      index === 0
        ? line.replace(/^\s*[×⚠]\s*/, '')
        : line.replace(/^\s*│ ?/, '')
    )
    .join('\n')
    .trim()
}

function fileOf(
  issue: CompilerIssue,
  root: string | undefined
): string | undefined {
  if (typeof issue.file === 'string' && issue.file) return issue.file

  const resource = issue.module?.resource
  if (typeof resource !== 'string' || !resource) return undefined
  if (!root || !path.isAbsolute(resource)) return resource

  return path.relative(root, resource).split(path.sep).join('/') || resource
}

export function toDiagnostic(
  issue: unknown,
  severity: Diagnostic['severity'],
  root?: string
): Diagnostic {
  const error = (
    issue && typeof issue === 'object' ? issue : {}
  ) as CompilerIssue
  const message =
    typeof issue === 'string'
      ? plainMessage(issue)
      : plainMessage(error.message)
  const file = fileOf(error, root)
  const line = finite(error.loc?.start?.line)
  const column = finite(error.loc?.start?.column)
  const name =
    typeof error.name === 'string' && error.name !== 'Error'
      ? error.name
      : undefined

  return {
    message,
    ...(file ? {file} : {}),
    ...(line !== undefined ? {line} : {}),
    ...(column !== undefined ? {column} : {}),
    severity,
    ...(name ? {name} : {})
  }
}

// Errors first, then warnings, capped the way the build summary caps its
// warnings so one frame never grows with the module count.
export function compilationDiagnostics(
  compilation: CompilationLike | null | undefined,
  root?: string
): {details: Diagnostic[]; truncated: boolean} {
  const base = root ?? compilation?.compiler?.context
  const errors = Array.isArray(compilation?.errors) ? compilation.errors : []
  const warnings = Array.isArray(compilation?.warnings)
    ? compilation.warnings
    : []
  const all = [
    ...errors.map((issue) => toDiagnostic(issue, 'error', base)),
    ...warnings.map((issue) => toDiagnostic(issue, 'warning', base))
  ]

  return {
    details: all.slice(0, MAX_SUMMARY_WARNINGS),
    truncated: all.length > MAX_SUMMARY_WARNINGS
  }
}
