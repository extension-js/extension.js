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
    // exclude any public/ entries as with pages.
    scripts: filterPublicEntrypoints(
      filterNodeToolingScripts(data.scripts),
      projectRoot,
      publicDir
    ),
    // Default behavior: auto-scan top-level ./extensions for companion
    // unpacked extensions (one level deep), with optional browser subfolders
    // handled by the resolver when applicable.
    extensions: {dir: './extensions'}
  }
}
