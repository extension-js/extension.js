//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {describeJsonParseFailure} from './json-parse-position'

// Blanks JSONC extensions (comments, trailing commas) to spaces so the result
// parses with JSON.parse at the offsets the author wrote. Strings stay verbatim.
function blank(text: string): string {
  return text.replace(/[^\r\n]/g, ' ')
}

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
      const start = i

      while (i < text.length && text[i] !== '\n') i++
      out += blank(text.slice(start, i))
      continue
    }

    if (char === '/' && text[i + 1] === '*') {
      const start = i

      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      out += blank(text.slice(start, i))
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
          const start = j

          while (j < text.length && text[j] !== '\n') j++
          buffered += blank(text.slice(start, j))
          continue
        }

        if (c === '/' && text[j + 1] === '*') {
          const start = j

          j += 2

          while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) {
            j++
          }

          j += 2
          buffered += blank(text.slice(start, j))
          continue
        }

        break
      }

      const nextChar = text[j] ?? ''
      out +=
        nextChar === '}' || nextChar === ']'
          ? ` ${buffered.slice(1)}`
          : buffered

      i = j
      continue
    }

    out += char
    i++
  }

  return out
}

// What a JSONC reader returns. A caller that knows the shape names it.
export type ParsedJsonc = unknown

// The keys of a Deno config the scaffold reads and writes. Every other key
// stays as the template wrote it.
export interface DenoConfig {
  imports?: Record<string, string>
  nodeModulesDir?: unknown
  tasks?: Record<string, unknown>
  [key: string]: unknown
}

export function parseJsoncSafe<T = ParsedJsonc>(text: string): T {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const stripped = stripJsoncExtensions(withoutBom)
  const json = stripped.trim() ? stripped : '{}'

  // Node's message quotes the file, and the scaffold relays this one.
  try {
    return JSON.parse(json)
  } catch {
    throw new SyntaxError(describeJsonParseFailure(json))
  }
}

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

// Dependencies declared through `npm:` specifiers in the project's
// deno.jsonc/deno.json `imports` map (package names and aliases).
export function readDenoConfigDependencies(
  projectPath: string
): Record<string, string> {
  const dependencies: Record<string, string> = {}

  // Deno discovers exactly one config file and prefers deno.json over
  // deno.jsonc; read the same file Deno would instead of merging both.
  const filename = ['deno.json', 'deno.jsonc'].find((candidate) =>
    fs.existsSync(path.join(projectPath, candidate))
  )
  if (!filename) return dependencies

  let config: DenoConfig | null

  try {
    config = parseJsoncSafe<DenoConfig | null>(
      fs.readFileSync(path.join(projectPath, filename), 'utf8')
    )
  } catch {
    return dependencies
  }

  const imports = config?.imports
  if (!imports || typeof imports !== 'object') return dependencies

  for (const [rawAlias, specifier] of Object.entries(imports)) {
    const parsed = parseNpmSpecifier(specifier)
    if (!parsed) continue

    dependencies[parsed.name] = dependencies[parsed.name] || parsed.version

    const alias = rawAlias.endsWith('/') ? rawAlias.slice(0, -1) : rawAlias

    if (alias && alias !== parsed.name) {
      dependencies[alias] = dependencies[alias] || parsed.version
    }
  }

  return dependencies
}
