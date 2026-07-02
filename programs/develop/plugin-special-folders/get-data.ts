// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import fs from 'fs'
import path from 'path'
import {type Compiler} from '@rspack/core'
import {getSpecialFoldersData} from 'browser-extension-manifest-fields'
import {type FilepathList} from '../types'
import {type CompanionExtensionsConfig} from './folder-extensions/types'

// `scripts/` is a near-universal folder name for npm/CI build & dev tooling, but
// Extension.js's `scripts/` special folder enrolls EVERY file in it as a
// standalone (content-script-like) entry. Node build scripts then fail the build
// on their Node-only imports (`fs-extra`, `esbuild`, `playwright`, `require('fs')`
// …) which can't resolve in a browser bundle (G13). A browser content script can
// never use these, so a file that imports a Node builtin / known build tool, or
// carries a `#!…node` shebang, is unambiguously build tooling — exclude it from
// the `scripts/` scan instead of trying (and failing) to bundle it.
const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'fs/promises', 'http',
  'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'repl', 'stream',
  'string_decoder', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util',
  'v8', 'vm', 'worker_threads', 'zlib'
])

// Node-only build/dev packages commonly required by `scripts/` tooling. A
// browser content script would never depend on these.
const NODE_BUILD_TOOLS = new Set([
  'fs-extra', 'esbuild', 'playwright', 'playwright-core', 'puppeteer',
  'puppeteer-core', 'webpack', 'rollup', 'vite', 'replace-in-file', 'zip-dir',
  'archiver', 'adm-zip', 'chokidar', 'glob', 'fast-glob', 'rimraf', 'yargs',
  'execa', 'cross-spawn', 'shelljs', 'web-ext', 'dotenv', 'node-fetch',
  'minimist', 'ora', 'chalk', 'gulp', 'grunt', 'ncp', 'del', 'cpy', 'tsx',
  'ts-node', 'nodemon', 'concurrently'
])

function importsNodeOnly(specifier: string): boolean {
  if (specifier.startsWith('node:')) return true
  // Strip any subpath (e.g. `fs/promises` keeps, `lodash/merge` -> `lodash`).
  const bare = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]
  return (
    NODE_BUILTINS.has(specifier) ||
    NODE_BUILTINS.has(bare) ||
    NODE_BUILD_TOOLS.has(bare)
  )
}

function isNodeToolingScript(absPath: string): boolean {
  let source: string
  try {
    source = fs.readFileSync(absPath, 'utf8')
  } catch {
    return false
  }

  // `#!/usr/bin/env node` (or any node shebang) => a CLI/build script.
  if (/^#!.*\bnode\b/.test(source)) return true

  // Collect every `require('x')` / `import … from 'x'` / `import 'x'` specifier
  // and check whether any is a Node builtin or a known Node-only build tool.
  const specifierRe =
    /(?:require\s*\(\s*|(?:import|export)\b[^'"()]*?\bfrom\s*|import\s*)['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = specifierRe.exec(source)) !== null) {
    if (importsNodeOnly(match[1])) return true
  }
  return false
}

function filterNodeToolingScripts(list: FilepathList | undefined): FilepathList {
  const next: FilepathList = {}

  for (const [key, value] of Object.entries(list || {})) {
    const paths = Array.isArray(value) ? value : value ? [value] : []
    const kept = paths.filter((entry) => {
      const abs = String(entry)
      if (!path.isAbsolute(abs)) return true
      return !isNodeToolingScript(abs)
    })
    if (kept.length === 0) continue
    next[key] = Array.isArray(value) ? kept : (kept[0] as any)
  }

  return next
}

// ── G13 option 2: only enroll `scripts/` files the extension actually uses ──
// The `scripts/` special folder auto-enrolls EVERY file in it as a standalone
// content-script entry. The Node-tooling filter above catches build/dev scripts
// that import Node builtins or carry a `#!node` shebang, but it can't see a plain
// data/generator helper (e.g. `data = {…}`, top-level `await`, no imports) — that
// file has no Node "tell", yet it's still not a browser script, so enrolling it
// breaks the build (G13 gap: `vict0rsch/PaperMemory`'s `scripts/cell.js`).
//
// A real `scripts/` file is referenced by the extension: listed in the manifest
// (`content_scripts`, `web_accessible_resources`, …), pulled from an HTML page, or
// injected at runtime via a string path (`chrome.scripting.executeScript({files:
// ['/scripts/x.js']})` — how the canonical special-folders-scripts example works).
// So keep a `scripts/` entry only if its project-relative path appears in the
// project's own extension assets; drop the ones referenced nowhere.
//
// Fail OPEN: if we can't read any reference assets (nothing to check against), keep
// everything — biasing toward a false-keep (a loud build error) over a false-drop
// (a script silently missing at runtime).

const REFERENCE_SOURCE_EXTS = new Set([
  '.html', '.htm', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts',
  '.cts', '.vue', '.svelte'
])

// Directories that never hold hand-authored reference assets. `scripts/` is
// excluded too: a reference to a scripts/ file comes from the extension's real
// entrypoints (background/content/popup/manifest), not from a sibling build tool
// inside scripts/ — including scripts/ would let a build script that reads a data
// helper (`fs.readFile('scripts/cell.js')`) falsely "reference" it.
const REFERENCE_SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', '.output', 'coverage', '.next',
  '.cache', '.git', '.turbo', 'scripts'
])

const REFERENCE_MAX_FILES = 4000
const REFERENCE_MAX_BYTES = 12 * 1024 * 1024

function collectReferenceCorpus(projectRoot: string): string {
  const parts: string[] = []
  let files = 0
  let bytes = 0

  const walk = (dir: string) => {
    if (files >= REFERENCE_MAX_FILES || bytes >= REFERENCE_MAX_BYTES) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, {withFileTypes: true})
    } catch {
      return
    }
    for (const entry of entries) {
      if (files >= REFERENCE_MAX_FILES || bytes >= REFERENCE_MAX_BYTES) return
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (REFERENCE_SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue
        }
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      const isManifest = /^manifest\b.*\.json$/i.test(entry.name)
      if (!isManifest && !REFERENCE_SOURCE_EXTS.has(ext)) continue
      try {
        const text = fs.readFileSync(full, 'utf8')
        parts.push(text)
        files += 1
        bytes += text.length
      } catch {
        // ignore unreadable files
      }
    }
  }

  walk(projectRoot)
  return files === 0 ? '' : parts.join('\n')
}

function filterUnreferencedScripts(
  list: FilepathList | undefined,
  projectRoot: string
): FilepathList {
  const entries = Object.entries(list || {})
  if (entries.length === 0) return list || {}

  const corpus = collectReferenceCorpus(projectRoot)
  // Fail open: no reference assets found → we can't tell, so keep everything.
  if (corpus === '') return list || {}

  const isReferenced = (entry: string): boolean => {
    const abs = String(entry)
    if (!path.isAbsolute(abs)) return true
    const rel = path.relative(projectRoot, abs).split(path.sep).join('/')
    // Match the project-relative path (`scripts/foo.js`) as a substring, which
    // also covers `/scripts/foo.js` runtime-injection paths.
    return corpus.includes(rel)
  }

  const next: FilepathList = {}
  for (const [key, value] of entries) {
    const paths = Array.isArray(value) ? value : value ? [value] : []
    const kept = paths.filter(isReferenced)
    if (kept.length === 0) continue
    next[key] = Array.isArray(value) ? kept : (kept[0] as any)
  }

  return next
}

function isUnderPublicDir(
  entry: string,
  projectRoot: string,
  publicDir: string
): boolean {
  if (!entry) return false

  const normalizedEntry = String(entry)
  const candidate = path.isAbsolute(normalizedEntry)
    ? normalizedEntry
    : path.join(projectRoot, normalizedEntry)
  const rel = path.relative(publicDir, candidate)
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel))
}

function filterPublicEntrypoints(
  list: FilepathList | undefined,
  projectRoot: string,
  publicDir: string
): FilepathList {
  const next: FilepathList = {}

  for (const [key, value] of Object.entries(list || {})) {
    if (Array.isArray(value)) {
      const filtered = value.filter(
        (entry) => !isUnderPublicDir(String(entry), projectRoot, publicDir)
      )
      if (filtered.length > 0) {
        next[key] = filtered
      }
      continue
    }

    if (typeof value === 'string') {
      if (!isUnderPublicDir(value, projectRoot, publicDir)) {
        next[key] = value
      }
      continue
    }
  }

  return next
}

export function getSpecialFoldersDataForCompiler(
  compiler: Compiler
): SpecialFoldersData {
  const projectRoot = compiler.options.context || ''
  const publicDir = path.join(projectRoot, 'public')
  const data = getSpecialFoldersData({
    // Use package.json path to get the project root directory
    // where special folders (pages/, scripts/, public/) are located
    manifestPath: path.join(projectRoot, 'package.json')
  })

  return finalizeSpecialFoldersData(data, projectRoot, publicDir)
}

export function getSpecialFoldersDataForProjectRoot(
  projectRoot: string
): SpecialFoldersData {
  const publicDir = path.join(projectRoot, 'public')
  const data = getSpecialFoldersData({
    manifestPath: path.join(projectRoot, 'package.json')
  })

  return finalizeSpecialFoldersData(data, projectRoot, publicDir)
}

type SpecialFoldersData = Omit<
  ReturnType<typeof getSpecialFoldersData>,
  'pages' | 'scripts'
> & {
  pages?: FilepathList
  scripts?: FilepathList
  extensions?: CompanionExtensionsConfig
}

function finalizeSpecialFoldersData(
  data: ReturnType<typeof getSpecialFoldersData>,
  projectRoot: string,
  publicDir: string
): SpecialFoldersData {
  return {
    ...data,
    // public/ is copy-only; exclude nested public entries from compilation entrypoints.
    pages: filterPublicEntrypoints(data.pages, projectRoot, publicDir),
    // Drop Node build/dev tooling that happens to live in `scripts/` (G13), then
    // drop any `scripts/` file the extension never references (G13 gap — data /
    // generator helpers with no Node tell), then exclude public/ entries as pages.
    scripts: filterPublicEntrypoints(
      filterUnreferencedScripts(
        filterNodeToolingScripts(data.scripts),
        projectRoot
      ),
      projectRoot,
      publicDir
    ),
    // Default behavior: auto-scan top-level ./extensions for companion
    // unpacked extensions (one level deep), with optional browser subfolders
    // handled by the resolver when applicable.
    extensions: {dir: './extensions'}
  }
}
