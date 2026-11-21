//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {parseJsonSafe} from '../../lib/parse-json-safe'
import {getSpecialFoldersDataForProjectRoot} from '../../lib/special-folders/get-data'
import {getResolvedManifestFieldsData} from '../../plugin-web-extension/shared/manifest-fields'
import type {DevOptions} from '../../types'

const TYPESCRIPT_SOURCE = /\.(ts|tsx|mts|cts|mtsx)$/i
const TYPE_DECLARATION = /\.d\.(ts|mts|cts|mtsx)$/i
const SCRIPT_SOURCE = /\.(js|cjs|mjs|jsx|mjsx|ts|tsx|mts|cts|mtsx)$/i
const SINGLE_FILE_COMPONENT = /\.(vue|svelte)$/i
const HTML_PAGE = /\.html?$/i

const SCRIPT_SRC = /<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi
const TYPESCRIPT_SCRIPT_BLOCK = /<script[^>]*\slang\s*=\s*["']tsx?["']/i
const RELATIVE_SPECIFIER =
  /(?:\bimport\s*\(\s*|\brequire\s*\(\s*|\bfrom\s*|\bimport\s*)['"`](\.{1,2}\/[^'"`\n$]+)['"`]/g

// TypeScript first: beside a compiled twin, the bundler takes the source.
const RESOLVE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte'
]
const JAVASCRIPT_SPELLING: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts']
}
const MAX_FILES = 2000

function isTypeScriptSource(file: string): boolean {
  return TYPESCRIPT_SOURCE.test(file) && !TYPE_DECLARATION.test(file)
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf-8')
  } catch {
    return undefined
  }
}

function resolveLocalImport(fromFile: string, specifier: string) {
  const target = path.resolve(
    path.dirname(fromFile),
    specifier.split(/[?#]/)[0]
  )
  const extension = path.extname(target)
  const candidates: string[] = []

  for (const spelling of JAVASCRIPT_SPELLING[extension] || []) {
    candidates.push(target.slice(0, -extension.length) + spelling)
  }

  candidates.push(target)

  for (const tried of RESOLVE_EXTENSIONS) {
    candidates.push(target + tried)
  }

  for (const tried of RESOLVE_EXTENSIONS) {
    candidates.push(path.join(target, `index${tried}`))
  }

  return candidates.find(isFile)
}

function entryFiles(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(entryFiles)

  return []
}

function collectEntries(lists: Array<Record<string, unknown> | undefined>) {
  return lists.flatMap((list) => Object.values(list || {}).flatMap(entryFiles))
}

// Whether the build compiles any TypeScript: a script the manifest names, a
// script a page loads, or a file one of those imports by a relative path.
export function buildReachesTypeScript(options: {
  projectRoot: string
  manifestPath: string
  browser?: DevOptions['browser']
}): boolean {
  const {projectRoot, manifestPath, browser} = options
  const manifestDir = path.dirname(manifestPath)

  let entries: string[]

  // A manifest nobody can read names no entry, so the folder scan stands.
  try {
    const manifest = parseJsonSafe(fs.readFileSync(manifestPath, 'utf-8'))

    if (!manifest || typeof manifest !== 'object') return true

    const fields = getResolvedManifestFieldsData({
      manifestPath,
      browser,
      projectPath: projectRoot
    })
    const folders = getSpecialFoldersDataForProjectRoot(projectRoot)

    entries = collectEntries([
      fields.html as Record<string, unknown> | undefined,
      fields.scripts as Record<string, unknown> | undefined,
      folders.pages as Record<string, unknown> | undefined,
      folders.scripts as Record<string, unknown> | undefined
    ])
  } catch {
    return true
  }

  const seen = new Set<string>()
  const queue = entries.map((entry) => path.resolve(manifestDir, entry))

  while (queue.length > 0 && seen.size < MAX_FILES) {
    const file = queue.shift() as string

    if (seen.has(file)) continue

    seen.add(file)

    if (isTypeScriptSource(file)) {
      if (isFile(file)) return true

      continue
    }

    const isPage = HTML_PAGE.test(file)
    const isComponent = SINGLE_FILE_COMPONENT.test(file)

    if (!isPage && !isComponent && !SCRIPT_SOURCE.test(file)) continue

    const source = readText(file)
    if (source === undefined) continue

    if (isComponent && TYPESCRIPT_SCRIPT_BLOCK.test(source)) return true

    if (isPage) {
      for (const match of source.matchAll(SCRIPT_SRC)) {
        const src = match[1].split(/[?#]/)[0]

        if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(src)) continue

        if (src.startsWith('/')) {
          queue.push(
            path.join(manifestDir, src.slice(1)),
            path.join(projectRoot, src.slice(1))
          )
        } else {
          queue.push(path.resolve(path.dirname(file), src))
        }
      }

      continue
    }

    for (const match of source.matchAll(RELATIVE_SPECIFIER)) {
      const resolved = resolveLocalImport(file, match[1])
      if (resolved) queue.push(resolved)
    }
  }

  return false
}
