// ██╗    ██╗███████╗██████╗       ███████╗██╗  ██╗████████╗███████╗███╗   ██╗███████╗██╗ ██████╗ ███╗   ██╗
// ██║    ██║██╔════╝██╔══██╗      ██╔════╝╚██╗██╔╝╚══██╔══╝██╔════╝████╗  ██║██╔════╝██║██╔═══██╗████╗  ██║
// ██║ █╗ ██║█████╗  ██████╔╝█████╗█████╗   ╚███╔╝    ██║   █████╗  ██╔██╗ ██║███████╗██║██║   ██║██╔██╗ ██║
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══╝   ██╔██╗    ██║   ██╔══╝  ██║╚██╗██║╚════██║██║██║   ██║██║╚██╗██║
// ╚███╔███╔╝███████╗██████╔╝      ███████╗██╔╝ ██╗   ██║   ███████╗██║ ╚████║███████║██║╚██████╔╝██║ ╚████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

const SCRIPT_SRC_PATTERN = /<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi

const RELATIVE_IMPORT_PATTERN =
  /(?:import\s[^'"]*|import\s*\(\s*|require\s*\(\s*|from\s*)['"](\.{1,2}\/[^'"]+)['"]/g

const SOURCE_SIBLING_EXTENSIONS = ['.ts', '.mts', '.tsx', '.jsx', '.mjs']
const MAX_IMPORT_DEPTH = 3

export function readIfFile(absPath: string): string | undefined {
  try {
    if (fs.statSync(absPath).isFile()) return fs.readFileSync(absPath, 'utf-8')
  } catch {
    // Ignore
  }

  return undefined
}

// Authors reference emitted names (panel.js) while sources sit beside them
// as panel.ts; accept either so TypeScript projects resolve too.
function readScriptSource(absPath: string): string | undefined {
  const direct = readIfFile(absPath)
  if (direct !== undefined) return direct

  const parsed = path.parse(absPath)

  for (const ext of SOURCE_SIBLING_EXTENSIONS) {
    const sibling = readIfFile(path.join(parsed.dir, parsed.name + ext))
    if (sibling !== undefined) return sibling
  }

  return undefined
}

function collectRelativeImports(source: string): string[] {
  const specifiers: string[] = []

  for (const match of source.matchAll(RELATIVE_IMPORT_PATTERN)) {
    specifiers.push(match[1])
  }

  return specifiers
}

// Walk a script's local import graph a few hops deep and hand each source to
// the collector: direct calls are the common shape, imports cover the rest.
export function scanScriptGraph(
  entryAbsPath: string,
  collect: (source: string) => string[]
): string[] {
  const found: string[] = []
  const queue: Array<{file: string; depth: number}> = [
    {file: entryAbsPath, depth: 0}
  ]
  const seen = new Set<string>()

  while (queue.length) {
    const {file, depth} = queue.shift() as {file: string; depth: number}
    if (seen.has(file)) continue

    seen.add(file)

    const source = readScriptSource(file)
    if (source === undefined) continue

    found.push(...collect(source))

    if (depth >= MAX_IMPORT_DEPTH) continue

    for (const specifier of collectRelativeImports(source)) {
      const resolved = path.resolve(path.dirname(file), specifier)
      const withExt = path.extname(resolved) ? resolved : `${resolved}.js`
      queue.push({file: withExt, depth: depth + 1})
    }
  }

  return found
}

// Inline scripts plus the local script graph of every <script src> a page loads.
export function scanPageScripts(
  htmlAbsPath: string,
  projectDir: string,
  collect: (source: string) => string[]
): string[] {
  const html = readIfFile(htmlAbsPath)
  if (html === undefined) return []

  const found = collect(html)

  for (const match of html.matchAll(SCRIPT_SRC_PATTERN)) {
    const src = String(match[1] || '')
    if (/^(https?:)?\/\//i.test(src)) continue

    const scriptAbs = src.startsWith('/')
      ? path.join(projectDir, src.slice(1))
      : path.resolve(path.dirname(htmlAbsPath), src)
    found.push(...scanScriptGraph(scriptAbs, collect))
  }

  return found
}

// A page path named in an API call resolves against the extension root. Keyed
// by that path, so the emitted page sits at the URL the browser asks for.
export function rootRelativePages(
  literals: string[],
  projectDir: string
): Record<string, string> {
  const pages: Record<string, string> = {}

  for (const literal of literals) {
    const rootRel = literal.replace(/^\.?\/+/, '').split(/[?#]/)[0]
    if (!rootRel || !/\.html?$/i.test(rootRel)) continue

    const absPage = path.join(projectDir, rootRel)
    const relToProject = path.relative(projectDir, absPage)
    if (!relToProject || relToProject.startsWith('..')) continue
    if (!fs.existsSync(absPage)) continue

    const key = rootRel.replace(/\.html?$/i, '').replace(/\\/g, '/')
    pages[key] = absPage
  }

  return pages
}
