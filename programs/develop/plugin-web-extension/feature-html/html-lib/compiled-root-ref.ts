// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

// Source spellings the build compiles to a root ref's .js path. Mirrors
// SOURCE_SIBLING_EXTENSIONS in feature-scripts/steps/trace-runtime-loaded-files.ts.
export const COMPILED_SIBLING_EXTENSIONS = [
  '.ts',
  '.mts',
  '.tsx',
  '.jsx',
  '.mjs'
] as const

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

// The source next to a root-absolute .js ref that the special-folders pipeline
// compiles to that path (lib/widget.ts for "/lib/widget.js"), or undefined.
// Only a .js ref gets a sibling, the same rule the tracer applies. public/
// copies verbatim, so a source under it never counts.
export function findCompiledRootRefSource(
  ref: string,
  projectRoot: string,
  publicRoot?: string
): string | undefined {
  if (!ref || !ref.startsWith('/') || ref.startsWith('//')) return undefined
  // On POSIX a real filesystem path is also "/"-prefixed, those are not refs.
  if (projectRoot && ref.startsWith(projectRoot)) return undefined

  const trimmed = ref.replace(/^\/+/, '')
  if (!trimmed) return undefined
  if (path.posix.extname(trimmed).toLowerCase() !== '.js') return undefined

  if (publicRoot && fs.existsSync(path.join(publicRoot, trimmed))) {
    return undefined
  }

  const candidate = path.resolve(projectRoot, trimmed)
  // Never escape the extension root (`/../../etc/passwd`).
  const rel = path.relative(projectRoot, candidate)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined

  const stem = candidate.slice(0, -'.js'.length)
  return COMPILED_SIBLING_EXTENSIONS.map((ext) => stem + ext).find(isFile)
}
