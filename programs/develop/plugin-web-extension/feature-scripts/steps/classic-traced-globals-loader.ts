// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance


import {createRequire} from 'node:module'
import {
  inputOrIdentityMap,
  returnWithMap
} from '../../../lib/loader-source-maps'

const requireModule = createRequire(import.meta.url)

const EXPOSE_SKIP = new Set([
  'module',
  'exports',
  'define',
  'require',
  'globalThis',
  'window',
  'self',
  'this'
])

interface LooseAstNode {
  type?: unknown
  kind?: unknown
  name?: unknown
  sourceType?: unknown
  id?: LooseAstNode | null
  left?: LooseAstNode
  value?: LooseAstNode
  argument?: LooseAstNode
  local?: LooseAstNode
  declaration?: LooseAstNode | null
  specifiers?: LooseAstNode[]
  properties?: Array<LooseAstNode | null>
  elements?: Array<LooseAstNode | null>
  declarations?: LooseAstNode[]
  body?: LooseAstNode[]
  source?: unknown
  [key: string]: unknown
}

function addBindingNames(
  node: LooseAstNode | null | undefined,
  into: string[]
) {
  if (!node || typeof node.type !== 'string') return

  switch (node.type) {
    case 'Identifier':
      into.push(String(node.name))

      return
    case 'ObjectPattern':
      for (const prop of node.properties || []) {
        if (!prop) continue

        addBindingNames(
          prop.type === 'RestElement' ? prop.argument : prop.value,
          into
        )
      }

      return
    case 'ArrayPattern':
      for (const element of node.elements || []) addBindingNames(element, into)

      return
    case 'AssignmentPattern':
      addBindingNames(node.left, into)

      return
    case 'RestElement':
      addBindingNames(node.argument, into)

      return
    default:
      return
  }
}

function addFromDeclaration(
  node: LooseAstNode | null | undefined,
  into: string[]
) {
  if (!node || typeof node.type !== 'string') return

  if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
    if (node.id) into.push(String(node.id.name))

    return
  }

  if (node.type === 'VariableDeclaration') {
    for (const declarator of node.declarations || []) {
      addBindingNames(declarator.id, into)
    }
  }
}

function parseProgram(content: string): LooseAstNode {
  const acorn = requireModule('acorn') as {
    parse: (code: string, opts: Record<string, unknown>) => LooseAstNode
  }
  const base = {ecmaVersion: 'latest', allowHashBang: true}

  try {
    return acorn.parse(content, {...base, sourceType: 'module'})
  } catch {
    return acorn.parse(content, {
      ...base,
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true
    })
  }
}

// Top-level function/var/let/const/class names the classic runtime can see,
// including `export function` / `export const`. Import bindings stay private.
export function collectExposableClassicNames(content: string): string[] {
  const ast = parseProgram(content)
  const names: string[] = []

  for (const statement of ast.body || []) {
    if (!statement || typeof statement.type !== 'string') continue
    if (statement.type === 'ImportDeclaration') continue
    if (statement.type === 'ExportAllDeclaration') continue

    if (statement.type === 'ExportDefaultDeclaration') {
      addFromDeclaration(statement.declaration, names)
      continue
    }

    if (statement.type === 'ExportNamedDeclaration') {
      addFromDeclaration(statement.declaration, names)

      // `export { foo }` re-exports a local binding, while `export { foo } from`
      // does not create one.
      if (!statement.source) {
        for (const specifier of statement.specifiers || []) {
          if (specifier.local) addBindingNames(specifier.local, names)
        }
      }

      continue
    }

    addFromDeclaration(statement, names)
  }

  return [
    ...new Set(
      names.filter(
        (name) => !EXPOSE_SKIP.has(name) && /^[A-Za-z_$][\w$]*$/.test(name)
      )
    )
  ]
}

function bridgeSource(names: string[]): string {
  if (names.length === 0) return ''

  const lines = [
    '',
    '/* extension.js: classic top-level declarations land on the global */'
  ]

  for (const name of names) {
    lines.push(
      `try { globalThis[${JSON.stringify(name)}] = ${name}; } catch (_e) { /* Ignore */ }`
    )
  }

  return lines.join('\n')
}

interface LoaderContext {
  resourcePath: string
  callback(err: Error | null, content?: string, sourceMap?: unknown): void
}

export default function classicTracedGlobalsLoader(
  this: LoaderContext,
  source: string,
  inputSourceMap?: unknown
): string | undefined {
  let names: string[] = []

  try {
    names = collectExposableClassicNames(source)
  } catch {
    // Ignore
  }

  const suffix = bridgeSource(names)
  const output = suffix ? source + suffix : source

  return returnWithMap(
    this,
    output,
    inputOrIdentityMap(inputSourceMap, this.resourcePath, source)
  )
}
