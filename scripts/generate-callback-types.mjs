#!/usr/bin/env node

import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXTENSION_DIR = path.join(ROOT, 'programs', 'extension')

export const OUTPUT_FILE = path.join(EXTENSION_DIR, 'types', 'callbacks.d.ts')

// Methods whose callback the browser calls with one argument per field,
// where chrome-types declares a single object that holds the fields.
export const SPREAD_CALLBACKS = {
  'devtools.inspectedWindow._eval': {generic: 'T = unknown', first: 'T'}
}

function skipString(source, start) {
  const quote = source[start]
  let index = start + 1

  while (index < source.length && source[index] !== quote) {
    index += source[index] === '\\' ? 2 : 1
  }

  return index
}

export function stripComments(source) {
  let out = ''
  let index = 0

  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      index = end === -1 ? source.length : end + 2
    } else if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index)
      index = end === -1 ? source.length : end
    } else if (char === "'" || char === '"' || char === '`') {
      const end = skipString(source, index)
      out += source.slice(index, end + 1)
      index = end + 1
    } else {
      out += char
      index++
    }
  }

  return out
}

const OPENERS = '({['
const CLOSERS = ')}]'

// The index just past the bracket that closes the one at `open`.
function closingIndex(source, open) {
  let depth = 0

  for (let index = open; index < source.length; index++) {
    const char = source[index]

    if (char === "'" || char === '"' || char === '`') {
      index = skipString(source, index)
    } else if (OPENERS.includes(char)) {
      depth++
    } else if (CLOSERS.includes(char)) {
      depth--

      if (depth === 0) return index + 1
    }
  }

  return source.length
}

// Splits on a separator that sits outside every bracket and type argument.
export function splitTopLevel(text, separator = ',') {
  const parts = []
  let depth = 0
  let angle = 0
  let start = 0

  for (let index = 0; index < text.length; index++) {
    const char = text[index]

    if (char === "'" || char === '"' || char === '`') {
      index = skipString(text, index)
    } else if (OPENERS.includes(char)) {
      depth++
    } else if (CLOSERS.includes(char)) {
      depth--
    } else if (char === '<') {
      angle++
    } else if (char === '>' && text[index - 1] !== '=') {
      angle--
    } else if (char === separator && depth === 0 && angle === 0) {
      parts.push(text.slice(start, index))
      start = index + 1
    }
  }

  parts.push(text.slice(start))

  return parts.map((part) => part.trim()).filter(Boolean)
}

function squash(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/,\s*([)}\]])/g, '$1')
    .replace(/([({[])\s+/g, '$1')
    .replace(/\s+([)}\]])/g, '$1')
    .trim()
}

/** @returns {{name: string, optional: boolean, type: string} | null} */
function parseParameter(text) {
  const match = text.match(/^([A-Za-z_$][\w$]*)(\?)?\s*:\s*([\s\S]+)$/)

  if (!match) return null

  return {name: match[1], optional: Boolean(match[2]), type: squash(match[3])}
}

// Every exported function with its namespace path, plus the interface names
// and type aliases that tell an object argument from a primitive one.
export function parseDeclarations(source) {
  const text = stripComments(source)
  const functions = []
  const interfaces = new Set()
  const aliases = new Map()
  const stack = []
  const pattern =
    /(?:declare\s+|export\s+)?namespace\s+([\w$.]+)\s*\{|export\s+function\s+([\w$]+)\s*\(|export\s+(?:interface|class)\s+([\w$]+)|export\s+type\s+([\w$]+)\s*=\s*([^;]+);|\{|\}/g
  let match = pattern.exec(text)

  while (match) {
    if (match[1]) {
      stack.push(match[1])
    } else if (match[2]) {
      const open = pattern.lastIndex - 1
      const close = closingIndex(text, open)
      let end = close
      let depth = 0

      // A return type can hold braces and semicolons of its own.
      for (; end < text.length; end++) {
        if (OPENERS.includes(text[end])) depth++
        else if (CLOSERS.includes(text[end])) depth--
        else if (text[end] === ';' && depth === 0) break
      }

      functions.push({
        namespace: stack.filter(Boolean).join('.'),
        name: match[2],
        parameters: splitTopLevel(text.slice(open + 1, close - 1)).map(
          parseParameter
        ),
        returns: squash(text.slice(close, end).replace(/^\s*:/, ''))
      })

      pattern.lastIndex = end + 1
    } else if (match[3]) {
      interfaces.add(match[3])
    } else if (match[4]) {
      if (!aliases.has(match[4])) aliases.set(match[4], squash(match[5]))
    } else if (match[0] === '{') {
      stack.push('')
    } else {
      stack.pop()
    }

    match = pattern.exec(text)
  }

  return {functions, interfaces, aliases}
}

function isFunctionType(type) {
  return /^\(.*\)\s*=>/.test(type)
}

// What the browser tells arguments apart by. "unknown" is a type this parser
// cannot place, so no argument is ever skipped past it.
export function kindOf(type, declarations, depth = 0) {
  if (/^(number|string|boolean)$/.test(type)) return type
  if (/^["'][^"']*["'](\s*\|\s*["'][^"']*["'])*$/.test(type)) return 'string'
  if (isFunctionType(type)) return 'function'
  if (/^\{.*\}$/.test(type)) return 'object'

  const named = type.match(/^(?:[\w$]+\.)*([\w$]+)$/)

  if (!named || depth > 4) return 'unknown'
  if (declarations.interfaces.has(named[1])) return 'object'

  const alias = declarations.aliases.get(named[1])

  return alias ? kindOf(alias, declarations, depth + 1) : 'unknown'
}

// Each way to pass some of the optional arguments and not all of them. One
// can be left out only when its kind differs from every argument after it.
export function argumentChoices(optionals, declarations) {
  const kinds = optionals.map((parameter) =>
    kindOf(parameter.type, declarations)
  )
  const choices = []

  for (let mask = 0; mask < (1 << optionals.length) - 1; mask++) {
    const kept = optionals.map((_, index) => Boolean(mask & (1 << index)))
    const sound = kept.every((isKept, index) => {
      if (isKept) return true

      if (!['number', 'string', 'boolean', 'object'].includes(kinds[index])) {
        return false
      }

      return kinds
        .slice(index + 1)
        .every(
          (later, offset) => !kept[index + 1 + offset] || later !== kinds[index]
        )
    })

    if (sound) choices.push(optionals.filter((_, index) => kept[index]))
  }

  return choices
}

function renderParameters(parameters) {
  return parameters
    .map((parameter) => `${parameter.name}: ${parameter.type}`)
    .join(', ')
}

function spreadCallback(type, rule) {
  const inner = type.slice(type.indexOf('(') + 1, type.lastIndexOf(') =>'))
  const response = parseParameter(inner.trim().replace(/,$/, ''))

  if (!response || !/^\{.*\}$/.test(response.type)) return null

  const fields = splitTopLevel(response.type.slice(1, -1)).map(parseParameter)

  if (fields.includes(null)) return null

  fields[0] = {
    .../** @type {{name: string, optional: boolean}} */ (fields[0]),
    type: rule.first
  }

  return `(${renderParameters(fields)}) => void`
}

// The overloads chrome-types leaves out: a callback passed right after the
// arguments that were given, with trailing optional ones left out.
export function callbackOverloads(source) {
  const declarations = parseDeclarations(source)
  const byNamespace = new Map()

  for (const fn of declarations.functions) {
    if (fn.returns !== 'void' || fn.parameters.includes(null)) continue

    const callback = fn.parameters.at(-1)

    if (!callback || !callback.optional || !isFunctionType(callback.type)) {
      continue
    }

    const before = fn.parameters.slice(0, -1)
    const firstOptional = before.findIndex((parameter) => parameter.optional)
    const required =
      firstOptional === -1 ? before : before.slice(0, firstOptional)
    const optionals = firstOptional === -1 ? [] : before.slice(firstOptional)

    if (optionals.some((parameter) => !parameter.optional)) continue

    const apiName = `${fn.namespace.replace(/^(browser|chrome)\./, '')}.${fn.name}`
    const rule = SPREAD_CALLBACKS[apiName]
    const callbackType = rule
      ? spreadCallback(callback.type, rule)
      : callback.type

    if (!callbackType) continue

    const choices = argumentChoices(optionals, declarations)

    // The declared full form has the wrong callback, so it is typed again.
    if (rule) choices.push(optionals)

    for (const chosen of choices) {
      // The spread form keeps its own type argument, so it has no guard.
      const generic = rule ? `<${rule.generic}>` : `<F extends ${callbackType}>`
      const parameters = renderParameters([
        ...required,
        ...chosen,
        {
          name: callback.name,
          type: rule ? callbackType : 'ExtensionCallback<F>'
        }
      ])
      const line = `export function ${fn.name}${generic}(${parameters}): void`
      const lines = byNamespace.get(fn.namespace) || new Set()

      lines.add(line)
      byNamespace.set(fn.namespace, lines)
    }
  }

  return byNamespace
}

export function renderCallbackTypes(source) {
  const blocks = []

  for (const [namespace, lines] of callbackOverloads(source)) {
    blocks.push(
      `declare namespace ${namespace} {\n${Array.from(lines)
        .map((line) => `  ${line}`)
        .join('\n')}\n}`
    )
  }

  return `// Generated by scripts/generate-callback-types.mjs from the chrome-types
// declarations. Do not edit: run the script again when chrome-types moves.
// The browser accepts a callback right after the arguments that were given.
// chrome-types declares it only after every optional argument.
// biome-ignore-all lint/suspicious/noExplicitAny: the argument types are copied from chrome-types
/// <reference types="chrome-types" />

// An argument typed any is not taken for a callback, so a call that
// passes one keeps the promise form chrome-types declares.
type ExtensionCallback<F> = 0 extends 1 & F ? never : F

${blocks.join('\n\n')}
`
}

// Formatting, quotes and separators are the formatter's, so two renderings
// are compared by their tokens alone.
export function comparable(text) {
  return text.replace(/"/g, "'").replace(/[\s,;]+/g, '')
}

export function chromeTypesFile() {
  const require = createRequire(path.join(EXTENSION_DIR, 'package.json'))

  return path.join(
    path.dirname(require.resolve('chrome-types/package.json')),
    'index.d.ts'
  )
}

function main() {
  const rendered = renderCallbackTypes(
    fs.readFileSync(chromeTypesFile(), 'utf8')
  )

  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUTPUT_FILE)
      ? fs.readFileSync(OUTPUT_FILE, 'utf8')
      : ''

    if (comparable(current) !== comparable(rendered)) {
      console.error(
        `${path.relative(ROOT, OUTPUT_FILE)} is behind chrome-types. Run node scripts/generate-callback-types.mjs`
      )

      process.exit(1)
    }

    return
  }

  fs.writeFileSync(OUTPUT_FILE, rendered)

  const formatted = spawnSync(
    path.join(ROOT, 'node_modules', '.bin', 'biome'),
    ['format', '--write', OUTPUT_FILE],
    {cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32'}
  )

  process.exit(formatted.status ?? 1)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
