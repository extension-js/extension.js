// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {blankComments} from '../../feature-scripts/steps/source-literals'

// The static imports and re-exports of a script, in source order. A text
// scan, not a parse: each must open a statement, so a string rarely matches.
const STATIC_IMPORT_RE =
  /(?:^|[;\n}])\s*(?:import\b\s*(?:type\s+)?(?:[\w$]+\s*,?\s*)?(?:\*\s*as\s+[\w$]+\s*|\{[^}]*\}\s*)?(?:from\s*)?|export\s*(?:type\s+)?(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*)(['"])([^'"\n]+)\1/g

export function staticImportSpecifiers(source: string): string[] {
  const code = blankComments(source)
  const specifiers: string[] = []

  for (const match of code.matchAll(STATIC_IMPORT_RE)) {
    specifiers.push(match[2])
  }

  return specifiers
}

export type ImportTarget =
  | {kind: 'file'; requestedPath: string}
  | {kind: 'package'}
  | {kind: 'remote'}

// Where the browser looks for an import of a script shipped at `scriptOutput`,
// resolved the way a URL is, so a climb past the root stops at the root.
export function importTarget(
  specifier: string,
  scriptOutput: string
): ImportTarget {
  if (specifier.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(specifier)) {
    return {kind: 'remote'}
  }

  if (
    !/^\.{0,2}\//.test(specifier) &&
    specifier !== '.' &&
    specifier !== '..'
  ) {
    return {kind: 'package'}
  }

  const base = `chrome-extension://extension/${scriptOutput.replace(/^\/+/, '')}`
  const {pathname} = new URL(specifier, base)
  let requestedPath = pathname.replace(/^\/+/, '')

  try {
    requestedPath = decodeURIComponent(requestedPath)
  } catch {
    // A malformed escape stays as written.
  }

  return {kind: 'file', requestedPath}
}
