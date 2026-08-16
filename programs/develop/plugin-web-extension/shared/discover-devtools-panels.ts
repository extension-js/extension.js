// ██╗    ██╗███████╗██████╗       ███████╗██╗  ██╗████████╗███████╗███╗   ██╗███████╗██╗ ██████╗ ███╗   ██╗
// ██║    ██║██╔════╝██╔══██╗      ██╔════╝╚██╗██╔╝╚══██╔══╝██╔════╝████╗  ██║██╔════╝██║██╔═══██╗████╗  ██║
// ██║ █╗ ██║█████╗  ██████╔╝█████╗█████╗   ╚███╔╝    ██║   █████╗  ██╔██╗ ██║███████╗██║██║   ██║██╔██╗ ██║
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══╝   ██╔██╗    ██║   ██╔══╝  ██║╚██╗██║╚════██║██║██║   ██║██║╚██╗██║
// ╚███╔███╔╝███████╗██████╔╝      ███████╗██╔╝ ██╗   ██║   ███████╗██║ ╚████║███████║██║╚██████╔╝██║ ╚████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {FilepathList} from '../../types'

// chrome.devtools.panels.create(title, icon, page, cb): the page argument is
// an extension-root-relative HTML path that never appears in the manifest,
// so entry collection cannot see it there. Literal-string calls are the
// documented shape and are statically findable in the devtools page graph.
const PANELS_CREATE_PATTERN =
  /panels\s*\.\s*create\s*\(\s*(['"`])(?:(?!\1).)*\1\s*,\s*(['"`])(?:(?!\2).)*\2\s*,\s*(['"`])((?:(?!\3).)*)\3/g

const SCRIPT_SRC_PATTERN = /<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi

const RELATIVE_IMPORT_PATTERN =
  /(?:import\s[^'"]*|import\s*\(\s*|require\s*\(\s*|from\s*)['"](\.{1,2}\/[^'"]+)['"]/g

const SOURCE_SIBLING_EXTENSIONS = ['.ts', '.mts', '.tsx', '.jsx', '.mjs']
const MAX_IMPORT_DEPTH = 3

function readIfFile(absPath: string): string | undefined {
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

function collectPanelLiterals(source: string): string[] {
  const literals: string[] = []
  for (const match of source.matchAll(PANELS_CREATE_PATTERN)) {
    const literal = String(match[4] || '').trim()
    if (literal) literals.push(literal)
  }
  return literals
}

function collectRelativeImports(source: string): string[] {
  const specifiers: string[] = []
  for (const match of source.matchAll(RELATIVE_IMPORT_PATTERN)) {
    specifiers.push(match[1])
  }
  return specifiers
}

// Walk the devtools page's local script graph a few hops deep: the corpus
// shape is a direct call in devtools.js, imports cover the bundled variants.
function scanScriptGraph(entryAbsPath: string, found: string[]): void {
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

    found.push(...collectPanelLiterals(source))

    if (depth >= MAX_IMPORT_DEPTH) continue
    for (const specifier of collectRelativeImports(source)) {
      const resolved = path.resolve(path.dirname(file), specifier)
      const withExt = path.extname(resolved) ? resolved : `${resolved}.js`
      queue.push({file: withExt, depth: depth + 1})
    }
  }
}

/**
 * Statically discovers HTML pages referenced only through
 * chrome.devtools.panels.create in the devtools page's scripts, and returns
 * them as extra HTML entries keyed by their extension-root-relative path so
 * the emitted dist serves the exact URL Chrome will request.
 */
export function discoverDevtoolsPanelPages(manifestPath: string): FilepathList {
  const projectDir = path.dirname(manifestPath)

  let devtoolsPage = ''
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    if (typeof manifest?.devtools_page === 'string') {
      devtoolsPage = manifest.devtools_page
    }
  } catch {
    // Ignore
  }
  if (!devtoolsPage) return {}

  const devtoolsHtmlPath = path.join(
    projectDir,
    devtoolsPage.replace(/^\/+/, '')
  )
  const devtoolsHtml = readIfFile(devtoolsHtmlPath)
  if (devtoolsHtml === undefined) return {}

  const literals: string[] = []
  // Inline devtools scripts can call panels.create without any src file.
  literals.push(...collectPanelLiterals(devtoolsHtml))

  for (const match of devtoolsHtml.matchAll(SCRIPT_SRC_PATTERN)) {
    const src = String(match[1] || '')
    if (/^(https?:)?\/\//i.test(src)) continue
    const scriptAbs = src.startsWith('/')
      ? path.join(projectDir, src.slice(1))
      : path.resolve(path.dirname(devtoolsHtmlPath), src)
    scanScriptGraph(scriptAbs, literals)
  }

  const pages: FilepathList = {}
  for (const literal of literals) {
    // The page path resolves against the extension root, per the API.
    const rootRel = literal.replace(/^\.?\/+/, '')
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
