// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Shared path utilities for plugin-web-extension features.

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {FilepathList} from '../../types'

export function isFromFilepathList(
  filePath: string,
  filepathList?: FilepathList
): boolean {
  return Object.values(filepathList || {}).some((value) => {
    return value === filePath
  })
}

export function getFilename(feature: string, filePath: string) {
  const entryExt = path.extname(filePath)

  let fileOutputpath = feature

  if (['.js', '.jsx', '.tsx', '.ts', '.vue', '.svelte'].includes(entryExt)) {
    fileOutputpath = fileOutputpath.replace(entryExt, '.js')
  }

  if (['.html', '.njk', '.nunjucks'].includes(entryExt)) {
    fileOutputpath = fileOutputpath.replace(entryExt, '.html')
  }

  if (['.css', '.scss', '.sass', '.less'].includes(entryExt)) {
    fileOutputpath = fileOutputpath.replace(entryExt, '.css')
  }

  return unixify(fileOutputpath || '')
}

export function unixify(filePath: string) {
  return filePath.replace(/\\/g, '/')
}

// Resolve a root-absolute ref (`/nscl/main.js`) against the EXTENSION ROOT, as
// Chrome does. Additive: public/ wins, and only existing root files are claimed.
export function resolveRootAbsoluteRef(
  ref: string,
  projectRoot: string,
  publicRoot?: string
): string | undefined {
  if (!ref || !ref.startsWith('/')) return undefined
  // On POSIX a real filesystem path is also "/"-prefixed; those are not refs.
  if (projectRoot && ref.startsWith(projectRoot)) return undefined
  if (ref.startsWith('//')) return undefined // protocol-relative URL

  const trimmed = ref.replace(/^\/+/, '')
  if (!trimmed) return undefined

  // public/ keeps precedence. It is the documented output-root contract.
  if (publicRoot && fs.existsSync(path.join(publicRoot, trimmed))) {
    return undefined
  }

  const candidate = path.resolve(projectRoot, trimmed)
  // Never escape the extension root (`/../../etc/passwd`).
  const rel = path.relative(projectRoot, candidate)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined

  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    return undefined
  }

  return candidate
}

/** Root-absolute refs in HTML (`src`/`href`) and CSS (`url(...)`). */
export function collectRootAbsoluteRefs(source: string): Set<string> {
  const refs = new Set<string>()
  const attrRe = /(?:src|href)\s*=\s*["'](\/[^"'#?]*)["']/gi
  const urlRe = /url\(\s*["']?(\/[^"')#?]+)["']?\s*\)/gi

  let m: RegExpExecArray | null
  while ((m = attrRe.exec(source))) refs.add(m[1])
  while ((m = urlRe.exec(source))) refs.add(m[1])

  return refs
}
