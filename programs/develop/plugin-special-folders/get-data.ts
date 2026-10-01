// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import fs from 'node:fs'
import path from 'node:path'
import type {Compiler} from '@rspack/core'
import {getSpecialFoldersData} from 'browser-extension-manifest-fields'
import {humanWarn, isDebug} from '../lib/messaging'
import type {FilepathList, SpecialFoldersConfig} from '../types'
import type {CompanionExtensionsConfig} from './folder-extensions/types'
import {
  publicFolderSetting,
  rememberedFolders,
  rememberSpecialFoldersConfig
} from './folders-config'
import * as messages from './messages'

export {rememberSpecialFoldersConfig}

// scripts/ enrolls EVERY file as a content-script-like entry, but Node build
// tooling (Node-builtin imports, node shebang) can never be one; exclude it.
const NODE_BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'dns',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib'
])

// Node-only build/dev packages commonly required by `scripts/` tooling. A
// browser content script would never depend on these.
const NODE_BUILD_TOOLS = new Set([
  'fs-extra',
  'esbuild',
  'playwright',
  'playwright-core',
  'puppeteer',
  'puppeteer-core',
  'webpack',
  'rollup',
  'vite',
  'replace-in-file',
  'zip-dir',
  'archiver',
  'adm-zip',
  'chokidar',
  'glob',
  'fast-glob',
  'rimraf',
  'yargs',
  'execa',
  'cross-spawn',
  'shelljs',
  'web-ext',
  'dotenv',
  'node-fetch',
  'minimist',
  'ora',
  'chalk',
  'gulp',
  'grunt',
  'ncp',
  'del',
  'cpy',
  'tsx',
  'ts-node',
  'nodemon',
  'concurrently'
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

  if (/^#!.*\bnode\b/.test(source)) return true

  const specifierRe =
    /(?:require\s*\(\s*|(?:import|export)\b[^'"()]*?\bfrom\s*|import\s*)['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null

  while ((match = specifierRe.exec(source)) !== null) {
    if (importsNodeOnly(match[1])) return true
  }

  return false
}

function filterNodeToolingScripts(
  list: FilepathList | undefined
): FilepathList {
  const next: FilepathList = {}

  for (const [key, value] of Object.entries(list || {})) {
    const paths = Array.isArray(value) ? value : value ? [value] : []
    const kept = paths.filter((entry) => {
      const abs = String(entry)
      if (!path.isAbsolute(abs)) return true

      return !isNodeToolingScript(abs)
    })
    if (kept.length === 0) continue

    next[key] = Array.isArray(value) ? kept : (kept[0] as (typeof next)[string])
  }

  return next
}

// Keep a scripts/ entry only if the extension actually references it (manifest,
// HTML, or runtime string path); fail OPEN when no reference assets are readable.

const REFERENCE_SOURCE_EXTS = new Set([
  '.html',
  '.htm',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.vue',
  '.svelte'
])

// Directories that never hold hand-authored reference assets. scripts/ is
// excluded too: a build script reading a data helper must not "reference" it.
const REFERENCE_SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.output',
  'coverage',
  '.next',
  '.cache',
  '.git',
  '.turbo',
  'scripts'
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
        // Ignore
      }
    }
  }

  walk(projectRoot)

  return files === 0 ? '' : parts.join('\n')
}

// Sources the compiler rewrites to .js: nobody injects `scripts/foo.ts`, they
// inject the `scripts/foo.js` the build emits.
const COMPILED_TO_JS_EXTS = new Set([
  '.ts',
  '.tsx',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs'
])

function referenceSpellings(relativePath: string): string[] {
  const ext = path.extname(relativePath).toLowerCase()
  if (!COMPILED_TO_JS_EXTS.has(ext)) return [relativePath]

  return [relativePath, `${relativePath.slice(0, -ext.length)}.js`]
}

const warnedDroppedScripts = new Set<string>()

function packageScriptsText(projectRoot: string): string {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
    const scripts = (JSON.parse(raw) as {scripts?: Record<string, unknown>})
      .scripts

    return Object.values(scripts || {})
      .map((value) => String(value))
      .join('\n')
  } catch {
    return ''
  }
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

  const isReferenced = (entry: string, key: string): boolean => {
    const abs = String(entry)
    if (!path.isAbsolute(abs)) return true

    const rel = path.relative(projectRoot, abs).split(path.sep).join('/')

    // Match the project-relative path (`scripts/foo.js`) as a substring, which
    // also covers `/scripts/foo.js` runtime-injection paths. A compiled source
    // is only ever injected by its emitted name, so accept that spelling too.
    // A folder moved by the `folders` config still emits under `scripts/`, so
    // the entry name is the spelling the extension references in that case.
    const spellings = new Set([
      ...referenceSpellings(rel),
      `${key}${path.extname(rel)}`,
      `${key}.js`
    ])

    return [...spellings].some((spelling) => corpus.includes(spelling))
  }

  const next: FilepathList = {}
  const dropped: string[] = []

  for (const [key, value] of entries) {
    const paths = Array.isArray(value) ? value : value ? [value] : []
    const kept = paths.filter((entry) => isReferenced(String(entry), key))

    for (const entry of paths) {
      if (kept.includes(entry)) continue

      const abs = String(entry)
      dropped.push(
        path.isAbsolute(abs)
          ? path.relative(projectRoot, abs).split(path.sep).join('/')
          : abs
      )
    }

    if (kept.length === 0) continue

    next[key] = Array.isArray(value) ? kept : (kept[0] as (typeof next)[string])
  }

  // Say it out loud: a dropped entry is invisible until production, and the
  // whole point of scripts/ is files the manifest never names. Once per set,
  // since the filter runs for every browser target in the same run.
  // A file the package.json scripts run is the repo's own tooling, not a
  // content script the author forgot to inject: drop it quietly. Everything
  // else is said out loud, since a silent drop is invisible until production.
  const tooling = packageScriptsText(projectRoot)
  const quiet = dropped.filter((rel) => tooling.includes(rel))
  const loud = dropped.filter((rel) => !tooling.includes(rel))

  if (quiet.length > 0 && isDebug()) {
    console.log(messages.unreferencedScriptDropped(quiet))
  }

  if (loud.length > 0) {
    const signature = loud.slice().sort().join('|')

    if (!warnedDroppedScripts.has(signature)) {
      warnedDroppedScripts.add(signature)
      humanWarn(messages.unreferencedScriptDropped(loud))
    }
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
    }
  }

  return next
}

// The fields package scans `<dir>/pages`, `<dir>/scripts` and `<dir>/public`
// for one dir. A folder moved elsewhere (`src/scripts`) is read from its own
// parent and only that folder is taken from the scan; `false` turns it off.
function scanSpecialFolders(
  projectRoot: string,
  folders: SpecialFoldersConfig
): ReturnType<typeof getSpecialFoldersData> {
  const base = getSpecialFoldersData({
    manifestPath: path.join(projectRoot, 'package.json')
  })
  const next = {...base}

  for (const name of ['pages', 'scripts'] as const) {
    const setting = folders[name]

    if (setting === false) {
      next[name] = {}
      continue
    }

    if (typeof setting !== 'string' || !setting.trim()) continue

    const abs = path.resolve(projectRoot, setting)

    if (path.resolve(projectRoot, name) === abs) continue

    const scanned = getSpecialFoldersData({
      manifestPath: path.join(path.dirname(abs), 'package.json')
    })

    next[name] = path.basename(abs) === name ? scanned[name] : {}
  }

  return next
}

export function getSpecialFoldersDataForCompiler(
  compiler: Compiler
): SpecialFoldersData {
  const projectRoot = compiler.options.context || ''

  return getSpecialFoldersDataForProjectRoot(projectRoot)
}

export function getSpecialFoldersDataForProjectRoot(
  projectRoot: string,
  folders: SpecialFoldersConfig = rememberedFolders(projectRoot)
): SpecialFoldersData {
  const setting = publicFolderSetting(projectRoot)
  const publicDir =
    setting.kind === 'path' ? setting.dir : path.join(projectRoot, 'public')
  const data = scanSpecialFolders(projectRoot, folders)

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
    // Drop Node build/dev tooling living in scripts/, then drop scripts/ files the
    // extension never references, then exclude public/ entries as pages.
    scripts: filterPublicEntrypoints(
      filterUnreferencedScripts(
        filterNodeToolingScripts(data.scripts),
        projectRoot
      ),
      projectRoot,
      publicDir
    ),
    // Default behavior: auto-scan top-level ./extensions for companion unpacked
    // extensions (one level deep), optional browser subfolders via the resolver.
    extensions: {dir: './extensions'}
  }
}
