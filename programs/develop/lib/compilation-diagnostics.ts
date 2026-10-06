// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {MAX_SUMMARY_WARNINGS} from './build-summary'
import {type DiagnosticContext, diagnosticCode} from './diagnostic-code'
import type {Diagnostic, ErrorCode} from './messaging'

export interface CompilationLike {
  errors?: unknown[]
  warnings?: unknown[]
  compiler?: {context?: string}
  entrypoints?: Map<string, {chunks?: Iterable<unknown>}>
  chunkGraph?: {
    getChunkModules?: (chunk: unknown) => Iterable<{resource?: unknown}>
  }
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

// The bundler reports a symlink-resolved resource, so the root is tried as
// given and as resolved before the path is left absolute.
function fileOf(
  issue: CompilerIssue,
  root: string | undefined
): string | undefined {
  if (typeof issue.file === 'string' && issue.file) return issue.file

  const resource = issue.module?.resource
  if (typeof resource !== 'string' || !resource) return undefined
  if (!root || !path.isAbsolute(resource)) return resource

  for (const base of [root, realpath(root)]) {
    const relative = path.relative(base, resource)

    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join('/')
    }
  }

  return resource
}

function realpath(dir: string): string {
  try {
    return fs.realpathSync.native(dir)
  } catch {
    return dir
  }
}

export function toDiagnostic(
  issue: unknown,
  severity: Diagnostic['severity'],
  root?: string,
  context: DiagnosticContext = {}
): Diagnostic {
  const error = (
    issue && typeof issue === 'object' ? issue : {}
  ) as CompilerIssue
  const message =
    typeof issue === 'string'
      ? plainMessage(issue)
      : plainMessage(error.message)
  const code = diagnosticCode(issue, context)
  const file = fileOf(error, root)
  const line = finite(error.loc?.start?.line)
  const column = finite(error.loc?.start?.column)
  const name =
    typeof error.name === 'string' && error.name !== 'Error'
      ? error.name
      : undefined

  return {
    ...(code ? {code} : {}),
    message,
    ...(file ? {file} : {}),
    ...(line !== undefined ? {line} : {}),
    ...(column !== undefined ? {column} : {}),
    severity,
    ...(name ? {name} : {})
  }
}

// A syntax failure is a content script's only when its module sits under a
// content_scripts entry, which the chunk graph knows and the error does not.
function contentScriptResources(
  compilation: CompilationLike | null | undefined
): Set<string> {
  const found = new Set<string>()
  const getChunkModules = compilation?.chunkGraph?.getChunkModules

  try {
    for (const [name, entry] of compilation?.entrypoints ?? []) {
      if (!name.startsWith('content_scripts/') || !getChunkModules) continue

      for (const chunk of entry.chunks ?? []) {
        for (const module of getChunkModules.call(
          compilation?.chunkGraph,
          chunk
        )) {
          if (typeof module?.resource === 'string') found.add(module.resource)
        }
      }
    }
  } catch {
    // A compilation without a chunk graph lists the diagnostics uncoded.
  }

  return found
}

// Errors first, then warnings, capped the way the build summary caps its
// warnings so one frame never grows with the module count.
export function compilationDiagnostics(
  input: unknown,
  root?: string
): {details: Diagnostic[]; truncated: boolean} {
  const compilation = input as CompilationLike | null | undefined
  const base = root ?? compilation?.compiler?.context
  const context = {contentScripts: contentScriptResources(compilation)}
  const errors = Array.isArray(compilation?.errors) ? compilation.errors : []
  const warnings = Array.isArray(compilation?.warnings)
    ? compilation.warnings
    : []
  const all = [
    ...errors.map((issue) => toDiagnostic(issue, 'error', base, context)),
    ...warnings.map((issue) => toDiagnostic(issue, 'warning', base, context))
  ]

  return {
    details: all.slice(0, MAX_SUMMARY_WARNINGS),
    truncated: all.length > MAX_SUMMARY_WARNINGS
  }
}

// The stats json the summary reads drops the warning's name, so the code is
// looked up by the same stripped text the summary prints.
export function warningCodes(input: unknown): Map<string, ErrorCode> {
  const compilation = input as CompilationLike | null | undefined
  const codes = new Map<string, ErrorCode>()

  for (const issue of compilation?.warnings ?? []) {
    const code = diagnosticCode(issue)
    if (!code) continue

    const message =
      issue && typeof issue === 'object'
        ? String((issue as CompilerIssue).message ?? '')
        : String(issue ?? '')
    codes.set(message.replace(ANSI_PATTERN, '').trim(), code)
  }

  return codes
}
