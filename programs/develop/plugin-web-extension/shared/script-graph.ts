// ██╗    ██╗███████╗██████╗       ███████╗██╗  ██╗████████╗███████╗███╗   ██╗███████╗██╗ ██████╗ ███╗   ██╗
// ██║    ██║██╔════╝██╔══██╗      ██╔════╝╚██╗██╔╝╚══██╔══╝██╔════╝████╗  ██║██╔════╝██║██╔═══██╗████╗  ██║
// ██║ █╗ ██║█████╗  ██████╔╝█████╗█████╗   ╚███╔╝    ██║   █████╗  ██╔██╗ ██║███████╗██║██║   ██║██╔██╗ ██║
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══╝   ██╔██╗    ██║   ██╔══╝  ██║╚██╗██║╚════██║██║██║   ██║██║╚██╗██║
// ╚███╔███╔╝███████╗██████╔╝      ███████╗██╔╝ ██╗   ██║   ███████╗██║ ╚████║███████║██║╚██████╔╝██║ ╚████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {
  getUserJsConfigFile,
  getUserTypeScriptConfigFile
} from '../../plugin-js-frameworks/js-tools/typescript'

const SCRIPT_SRC_PATTERN = /<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi

const RELATIVE_IMPORT_PATTERN =
  /(?:import\s[^'"]*|import\s*\(\s*|require\s*\(\s*|from\s*)['"](\.{1,2}\/[^'"]+)['"]/g

// Every module specifier a source names: static import, export from,
// import() and require() with a literal. A commented one only costs a read.
const MODULE_SPECIFIER_PATTERN =
  /(?:\bimport\s*\(\s*|\brequire\s*\(\s*|\bfrom\s*|\bimport\s*)(['"`])([^'"`\n$]+)\1/g

const SOURCE_SIBLING_EXTENSIONS = ['.ts', '.mts', '.tsx', '.jsx', '.mjs']
const MAX_IMPORT_DEPTH = 3

// The same lists the bundler resolves with, so a specifier lands on the
// file the build compiles.
const RESOLVE_EXTENSIONS = [
  '.js',
  '.cjs',
  '.mjs',
  '.jsx',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.json',
  '.svelte',
  '.vue'
]
const RESOLVE_EXTENSION_ALIAS = {
  '.js': ['.ts', '.tsx', '.js', '.jsx'],
  '.mjs': ['.mts', '.mjs'],
  '.cjs': ['.cts', '.cjs']
}
const SCRIPT_SOURCE = /\.(?:[cm]?[jt]s|[jt]sx|vue|svelte)$/i
const SINGLE_FILE_COMPONENT = /\.(?:vue|svelte)$/i
const COMPONENT_SCRIPT_BLOCK = /<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi
const NODE_MODULES_SEGMENT = /[\\/]node_modules[\\/]/

export const MAX_LOCAL_IMPORT_DEPTH = 8
export const MAX_LOCAL_IMPORT_FILES = 2000

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

export function collectModuleSpecifiers(source: string): string[] {
  const specifiers: string[] = []

  for (const match of source.matchAll(MODULE_SPECIFIER_PATTERN)) {
    specifiers.push(match[2])
  }

  return specifiers
}

// The script a source file holds. A single file component keeps its code
// in script blocks, and its markup would only confuse a text scan.
export function readScriptText(file: string): string | undefined {
  const source = readIfFile(file)
  if (source === undefined || !SINGLE_FILE_COMPONENT.test(file)) return source

  return [...source.matchAll(COMPONENT_SCRIPT_BLOCK)]
    .map((block) => block[1])
    .join('\n')
}

export type LocalImportResolver = (
  fromFile: string,
  specifier: string
) => string | undefined

// Resolves a specifier the way the build does, through the bundler's own
// resolver: extensions, index files and tsconfig or jsconfig paths.
export function createLocalImportResolver(
  projectPath: string
): LocalImportResolver {
  type Factory = InstanceType<
    typeof rspack.experiments.resolver.ResolverFactory
  >
  let factory: Factory | null | undefined

  const getFactory = (): Factory | null => {
    if (factory !== undefined) return factory

    try {
      const configFile =
        getUserTypeScriptConfigFile(projectPath) ??
        getUserJsConfigFile(projectPath)

      factory = new rspack.experiments.resolver.ResolverFactory({
        extensions: RESOLVE_EXTENSIONS,
        extensionAlias: RESOLVE_EXTENSION_ALIAS,
        // A linked package keeps its node_modules path and is not followed.
        symlinks: false,
        ...(configFile ? {tsconfig: {configFile, references: 'auto'}} : {})
      })
    } catch {
      factory = null
    }

    return factory
  }

  return (fromFile, specifier) => {
    try {
      const resolved = getFactory()?.sync(path.dirname(fromFile), specifier)
      const file = resolved?.path
      if (!file || !SCRIPT_SOURCE.test(file)) return undefined
      if (NODE_MODULES_SEGMENT.test(file)) return undefined

      return file
    } catch {
      return undefined
    }
  }
}

// Every local file the entries reach through imports, entries included,
// breadth first. Each file is asked once for the files it imports.
export function walkLocalImportGraph(
  entries: string[],
  importsOf: (file: string) => string[]
): string[] {
  const seen = new Set<string>()
  let level = entries

  for (
    let depth = 0;
    depth <= MAX_LOCAL_IMPORT_DEPTH && level.length > 0;
    depth++
  ) {
    const next: string[] = []

    for (const file of level) {
      if (seen.has(file) || seen.size >= MAX_LOCAL_IMPORT_FILES) continue

      seen.add(file)

      // The deepest file is still read, only its own imports are left.
      const imports = importsOf(file)
      if (depth < MAX_LOCAL_IMPORT_DEPTH) next.push(...imports)
    }

    level = next
  }

  return [...seen]
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
