// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {type ParsedJson, stripBom} from './parse-json-safe'

// Files that mark a directory as a project root and declare its dependencies:
// package.json (npm family) and deno.json(c) (npm: specifiers in imports).
export const PROJECT_MANIFEST_FILENAMES = [
  'package.json',
  'deno.jsonc',
  'deno.json'
] as const

export const DENO_CONFIG_FILENAMES = ['deno.jsonc', 'deno.json'] as const

// Removes JSONC extensions (comments, trailing commas) so the result parses
// with JSON.parse; string contents are preserved verbatim.
export function stripJsoncExtensions(text: string): string {
  let out = ''
  let i = 0
  let inString = false

  const flushPendingComma = (buffered: string, nextChar: string): string =>
    nextChar === '}' || nextChar === ']' ? buffered.slice(1) : buffered

  while (i < text.length) {
    const char = text[i]

    if (inString) {
      out += char
      if (char === '\\' && i + 1 < text.length) {
        out += text[i + 1]
        i += 2
        continue
      }
      if (char === '"') inString = false
      i++
      continue
    }

    if (char === '"') {
      inString = true
      out += char
      i++
      continue
    }

    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }

    if (char === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }

    if (char === ',') {
      // Buffer the comma plus trailing whitespace/comments; drop it when the
      // next significant character closes the object/array (trailing comma).
      let buffered = ','
      let j = i + 1
      while (j < text.length) {
        const c = text[j]
        if (/\s/.test(c)) {
          buffered += c
          j++
          continue
        }
        if (c === '/' && text[j + 1] === '/') {
          while (j < text.length && text[j] !== '\n') j++
          continue
        }
        if (c === '/' && text[j + 1] === '*') {
          j += 2
          while (j < text.length && !(text[j] === '*' && text[j + 1] === '/'))
            j++
          j += 2
          continue
        }
        break
      }
      out += flushPendingComma(buffered, text[j] ?? '')
      i = j
      continue
    }

    out += char
    i++
  }

  return out
}

// JSON.parse for JSONC input; empty input parses as {}, invalid syntax throws.
export function parseJsoncSafe(text: string | Buffer): ParsedJson {
  const stripped = stripJsoncExtensions(stripBom(text))
  return JSON.parse(stripped.trim() || '{}')
}

// Parses an npm: import specifier into package name and version range,
// including scoped, path-form, and versionless shapes.
export function parseNpmSpecifier(
  specifier: unknown
): {name: string; version: string} | undefined {
  if (typeof specifier !== 'string' || !specifier.startsWith('npm:')) {
    return undefined
  }

  let rest = specifier.slice('npm:'.length)
  if (rest.startsWith('/')) rest = rest.slice(1)
  if (!rest) return undefined

  // Scoped names contain a '@' at position 0 that is not a version separator.
  const versionSeparator = rest.indexOf('@', rest.startsWith('@') ? 1 : 0)
  if (versionSeparator === -1) {
    // Strip any subpath from the versionless form (npm:pkg/subpath).
    const name = rest.split('/', rest.startsWith('@') ? 2 : 1).join('/')
    return name ? {name, version: '*'} : undefined
  }

  const name = rest.slice(0, versionSeparator)
  // The version ends at the subpath boundary (npm:/pkg@1.2.3/subpath).
  const version = rest.slice(versionSeparator + 1).split('/')[0] || '*'
  return name ? {name, version} : undefined
}

export function findDenoConfigPath(projectDir: string): string | undefined {
  for (const filename of DENO_CONFIG_FILENAMES) {
    const candidate = path.join(projectDir, filename)
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // Ignore
    }
  }
  return undefined
}

// Dependencies a deno.json(c) declares through npm: specifiers; both the
// package name and the import alias are registered.
export function readDenoConfigDependencies(
  denoConfigPath: string
): Record<string, string> {
  const dependencies: Record<string, string> = {}

  let config: ParsedJson
  try {
    config = parseJsoncSafe(fs.readFileSync(denoConfigPath, 'utf8'))
  } catch {
    return dependencies
  }

  const imports = config?.imports
  if (!imports || typeof imports !== 'object') return dependencies

  for (const [rawAlias, specifier] of Object.entries(imports)) {
    const parsed = parseNpmSpecifier(specifier)
    if (!parsed) continue

    dependencies[parsed.name] = dependencies[parsed.name] || parsed.version

    // Subpath aliases end with '/' ("react/": "npm:react@18/").
    const alias = rawAlias.endsWith('/') ? rawAlias.slice(0, -1) : rawAlias
    if (alias && alias !== parsed.name) {
      dependencies[alias] = dependencies[alias] || parsed.version
    }
  }

  return dependencies
}

function readPackageJsonDependencies(
  packageJsonPath: string
): Record<string, string> {
  try {
    const pkg = JSON.parse(
      stripBom(fs.readFileSync(packageJsonPath, 'utf8')) || '{}'
    ) as Record<string, ParsedJson>
    const sections = [
      pkg.dependencies,
      pkg.devDependencies,
      pkg.optionalDependencies,
      pkg.peerDependencies
    ]
    const dependencies: Record<string, string> = {}
    for (const section of sections) {
      if (!section || typeof section !== 'object') continue
      for (const [name, version] of Object.entries(section)) {
        if (typeof version !== 'string') continue
        dependencies[name] = dependencies[name] || version
      }
    }
    return dependencies
  } catch {
    return {}
  }
}

// The project's declared dependencies merged across manifests;
// package.json wins when both declare the same package.
export function readProjectDependencies(
  projectDir: string
): Record<string, string> {
  const denoConfigPath = findDenoConfigPath(projectDir)
  const denoDependencies = denoConfigPath
    ? readDenoConfigDependencies(denoConfigPath)
    : {}

  // Read-and-catch rather than existsSync-then-read: cheaper, and callers
  // (and specs) that intercept reads don't all intercept stat calls.
  const packageJsonDependencies = readPackageJsonDependencies(
    path.join(projectDir, 'package.json')
  )

  return {...denoDependencies, ...packageJsonDependencies}
}

export function hasProjectDependency(
  projectDir: string,
  packageName: string
): boolean {
  return packageName in readProjectDependencies(projectDir)
}

export function findNearestProjectManifestDirSync(
  startPath: string,
  maxDepth = 6
): string | undefined {
  let currentDirectory = startPath
  for (let i = 0; i < maxDepth; i++) {
    if (
      PROJECT_MANIFEST_FILENAMES.some((filename) =>
        fs.existsSync(path.join(currentDirectory, filename))
      )
    ) {
      return currentDirectory
    }
    const parentDirectory = path.dirname(currentDirectory)
    if (parentDirectory === currentDirectory) break
    currentDirectory = parentDirectory
  }
  return undefined
}

// Find-up variant returning the manifest path itself, preferring package.json;
// walks to the filesystem root like findNearestPackageJsonSync.
export function findNearestProjectManifestSync(
  manifestPath: string
): string | null {
  const root = path.parse(manifestPath).root
  let currentDir = path.dirname(manifestPath)

  while (true) {
    for (const filename of PROJECT_MANIFEST_FILENAMES) {
      const candidate = path.join(currentDir, filename)
      try {
        if (fs.statSync(candidate).isFile()) return candidate
      } catch {
        // Ignore
      }
    }
    if (currentDir === root) return null
    currentDir = path.dirname(currentDir)
  }
}

// Walks up from the extension manifest to the nearest deno.json(c),
// mirroring findNearestPackageJson's contract.
export function findNearestDenoConfigSync(manifestPath: string): string | null {
  const root = path.parse(manifestPath).root
  let currentDir = path.dirname(manifestPath)

  while (true) {
    const found = findDenoConfigPath(currentDir)
    if (found) return found
    if (currentDir === root) return null
    currentDir = path.dirname(currentDir)
  }
}

/** True when the file exists and parses as JSONC. */
export function validateDenoConfig(denoConfigPath: string): boolean {
  try {
    if (!fs.existsSync(denoConfigPath)) return false
    parseJsoncSafe(fs.readFileSync(denoConfigPath, 'utf8'))
    return true
  } catch {
    return false
  }
}
