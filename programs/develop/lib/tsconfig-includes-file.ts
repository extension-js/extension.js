//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {parseJsoncSafe} from './project-manifest'

type TsConfig = {
  extends?: unknown
  files?: unknown
  include?: unknown
  exclude?: unknown
  references?: unknown
}

type FileList = {dir: string; entries: string[]}

const MAX_CONFIGS = 24

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

function readConfig(configPath: string): TsConfig | undefined {
  try {
    const parsed = parseJsoncSafe(fs.readFileSync(configPath, 'utf8'))

    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

function resolveExtends(specifier: string, fromDir: string): string | null {
  const isPath = specifier.startsWith('.') || path.isAbsolute(specifier)

  if (isPath) {
    const target = path.resolve(fromDir, specifier)
    const candidates = [target, `${target}.json`]

    return (
      candidates.find((file) => fs.existsSync(file) && !isDirectory(file)) ||
      null
    )
  }

  const requireFrom = createRequire(path.join(fromDir, 'tsconfig.json'))

  for (const request of [
    specifier,
    `${specifier}.json`,
    `${specifier}/tsconfig.json`
  ]) {
    try {
      return requireFrom.resolve(request)
    } catch {
      // Try the next spelling
    }
  }

  return null
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  return value.filter((entry): entry is string => typeof entry === 'string')
}

// `files`, `include` and `exclude` each come from the nearest config in the
// extends chain that sets them, and their paths are relative to that config.
function inheritedList(
  configPath: string,
  key: 'files' | 'include' | 'exclude',
  seen: Set<string>
): FileList | undefined {
  if (seen.has(configPath) || seen.size >= MAX_CONFIGS) return undefined

  seen.add(configPath)

  const config = readConfig(configPath)
  if (!config) return undefined

  const dir = path.dirname(configPath)
  const own = stringList(config[key])
  if (own) return {dir, entries: own}

  const parents =
    typeof config.extends === 'string'
      ? [config.extends]
      : stringList(config.extends) || []

  // A later entry of an extends array wins over an earlier one.
  for (const specifier of parents.slice().reverse()) {
    const parent = resolveExtends(specifier, dir)
    const found = parent ? inheritedList(parent, key, seen) : undefined
    if (found) return found
  }

  return undefined
}

const REGEXP_CHARS = /[.+^${}()|[\]\\]/g

// TypeScript's own reading of a pattern: `**/` is any depth, `*` and `?`
// stay inside one segment, and a last segment with neither is a folder.
function patternToRegExp(pattern: string, dir: string): RegExp {
  let absolute = toPosix(path.resolve(dir, pattern))
  const last = absolute.slice(absolute.lastIndexOf('/') + 1)
  const hasWildcard = /[*?]/.test(last)

  if (
    last === '**' ||
    (!hasWildcard && (isDirectory(absolute) || !last.includes('.')))
  ) {
    absolute = `${absolute.replace(/\/\*\*$/, '')}/**/*`
  }

  const source = absolute
    .split('/')
    .map((segment) =>
      segment === '**'
        ? '(?:[^/]+/)*'
        : `${segment
            .replace(REGEXP_CHARS, '\\$&')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '[^/]')}/`
    )
    .join('')
    .replace(/\/$/, '')

  return new RegExp(`^${source}$`, 'i')
}

function matchesAny(file: string, list: FileList | undefined): boolean {
  if (!list) return false

  return list.entries.some((pattern) =>
    patternToRegExp(pattern, list.dir).test(file)
  )
}

const CONFIG_DIR = '${configDir}'

// A shared base config writes ${configDir} for the folder of the config
// that extends it, wherever the base itself is kept.
function rooted(
  list: FileList | undefined,
  configDir: string
): FileList | undefined {
  if (!list) return undefined

  return {
    dir: list.dir,
    entries: list.entries.map((entry) =>
      entry.startsWith(CONFIG_DIR)
        ? path.join(configDir, entry.slice(CONFIG_DIR.length))
        : entry
    )
  }
}

function includesFile(
  configPath: string,
  file: string,
  seen: Set<string>
): boolean {
  if (seen.has(configPath) || seen.size >= MAX_CONFIGS) return false

  seen.add(configPath)

  const config = readConfig(configPath)
  // A config that cannot be read answers nothing, so the file is assumed in.
  if (!config) return true

  const configDir = path.dirname(configPath)
  const files = rooted(inheritedList(configPath, 'files', new Set()), configDir)
  const include = rooted(
    inheritedList(configPath, 'include', new Set()),
    configDir
  )
  const exclude = rooted(
    inheritedList(configPath, 'exclude', new Set()),
    configDir
  )

  const listed =
    !!files &&
    files.entries.some(
      (entry) =>
        toPosix(path.resolve(files.dir, entry)).toLowerCase() ===
        file.toLowerCase()
    )
  if (listed) return true

  // With neither key the program is every file under the config's folder.
  const effectiveInclude =
    include || (files ? undefined : {dir: configDir, entries: ['**/*']})

  if (matchesAny(file, effectiveInclude) && !matchesAny(file, exclude)) {
    return true
  }

  const references = Array.isArray(config.references) ? config.references : []

  return references.some((reference) => {
    const target = (reference as {path?: unknown} | null)?.path
    if (typeof target !== 'string') return false

    const resolved = path.resolve(path.dirname(configPath), target)
    const referenced = isDirectory(resolved)
      ? path.join(resolved, 'tsconfig.json')
      : resolved

    return fs.existsSync(referenced) && includesFile(referenced, file, seen)
  })
}

// True when the TypeScript program this config describes, or one it
// references, would pick the file up if it existed at that path.
export function tsconfigCanIncludeFile(
  configPath: string,
  filePath: string
): boolean {
  return includesFile(
    path.resolve(configPath),
    toPosix(path.resolve(filePath)),
    new Set()
  )
}
