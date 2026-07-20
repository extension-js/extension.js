//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Removes JSONC extensions (// and block comments, trailing commas) so the
 * result parses with JSON.parse. String contents, including commas and
 * comment-looking sequences inside them, are preserved verbatim.
 * (Mirror of extension-develop's lib/project-manifest.ts; the programs are
 * separate packages and don't share source.)
 */
function stripJsoncExtensions(text: string): string {
  let out = ''
  let i = 0
  let inString = false

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
      const nextChar = text[j] ?? ''
      out += nextChar === '}' || nextChar === ']' ? buffered.slice(1) : buffered
      i = j
      continue
    }

    out += char
    i++
  }

  return out
}

export function parseJsoncSafe(text: string): any {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const stripped = stripJsoncExtensions(withoutBom)
  return JSON.parse(stripped.trim() || '{}')
}

/**
 * Parses an `npm:` import specifier into its package name and version range.
 */
export function parseNpmSpecifier(
  specifier: unknown
): {name: string; version: string} | undefined {
  if (typeof specifier !== 'string' || !specifier.startsWith('npm:')) {
    return undefined
  }

  let rest = specifier.slice('npm:'.length)
  if (rest.startsWith('/')) rest = rest.slice(1)
  if (!rest) return undefined

  const versionSeparator = rest.indexOf('@', rest.startsWith('@') ? 1 : 0)
  if (versionSeparator === -1) {
    const name = rest.split('/', rest.startsWith('@') ? 2 : 1).join('/')
    return name ? {name, version: '*'} : undefined
  }

  const name = rest.slice(0, versionSeparator)
  const version = rest.slice(versionSeparator + 1).split('/')[0] || '*'
  return name ? {name, version} : undefined
}

/**
 * Dependencies declared through `npm:` specifiers in the project's
 * deno.jsonc/deno.json `imports` map (package names and aliases).
 */
export function readDenoConfigDependencies(
  projectPath: string
): Record<string, string> {
  const dependencies: Record<string, string> = {}

  for (const filename of ['deno.jsonc', 'deno.json']) {
    const configPath = path.join(projectPath, filename)
    let config: any
    try {
      config = parseJsoncSafe(fs.readFileSync(configPath, 'utf8'))
    } catch {
      continue
    }

    const imports = config?.imports
    if (!imports || typeof imports !== 'object') continue

    for (const [rawAlias, specifier] of Object.entries(imports)) {
      const parsed = parseNpmSpecifier(specifier)
      if (!parsed) continue

      dependencies[parsed.name] = dependencies[parsed.name] || parsed.version

      const alias = rawAlias.endsWith('/') ? rawAlias.slice(0, -1) : rawAlias
      if (alias && alias !== parsed.name) {
        dependencies[alias] = dependencies[alias] || parsed.version
      }
    }
  }

  return dependencies
}
