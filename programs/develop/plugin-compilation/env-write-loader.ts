//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as acorn from 'acorn'
import * as messages from './compilation-lib/messages'

interface EnvWriteLoaderContext {
  resourcePath: string
  getOptions(): {names?: string[]}
  emitWarning(warning: Error): void
  callback(
    error: Error | null,
    source?: string,
    map?: unknown,
    meta?: unknown
  ): void
}

interface Node {
  type: string
  start: number
  end: number
  loc?: {start: {line: number; column: number}}
  [key: string]: unknown
}

export interface EnvWrite {
  name: string
  read: string
  line: number
}

// Cheap text test first, so a module that never writes to an env object is
// never parsed. A miss here only skips the rewrite, the parse decides the rest.
const MAY_WRITE_ENV =
  /(?:process|import\.meta)\s*\.\s*env\s*(?:\.\s*[\w$]+|\[[^\]\n]*\])\s*(?:(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])?=(?!=)|\+\+|--|\s(?:of|in)\b)|(?:delete|\+\+|--)\s*\(?\s*(?:process|import\.meta)\s*\.\s*env\b/

function isEnvObject(node: Node | undefined): boolean {
  if (node?.type !== 'MemberExpression' || node.computed) return false

  const property = node.property as Node & {name?: string}
  if (property.type !== 'Identifier' || property.name !== 'env') return false

  const object = node.object as Node & {
    name?: string
    meta?: {name?: string}
    property?: {name?: string}
  }

  return (
    (object.type === 'Identifier' && object.name === 'process') ||
    (object.type === 'MetaProperty' &&
      object.meta?.name === 'import' &&
      object.property?.name === 'meta')
  )
}

function envKey(node: Node): string | undefined {
  const property = node.property as Node & {name?: string; value?: unknown}

  if (!node.computed && property.type === 'Identifier') return property.name

  if (property.type === 'Literal' && typeof property.value === 'string') {
    return property.value
  }

  return undefined
}

// Every place a member expression is written to rather than read.
function writeTargets(node: Node): Node[] {
  switch (node.type) {
    case 'AssignmentExpression':
      return [node.left as Node]
    case 'UpdateExpression':
      return [node.argument as Node]
    case 'UnaryExpression':
      return node.operator === 'delete' ? [node.argument as Node] : []
    case 'ForInStatement':
    case 'ForOfStatement':
      return [node.left as Node]
    default:
      return []
  }
}

// Destructuring patterns hold targets of their own.
function patternTargets(target: Node): Node[] {
  switch (target.type) {
    case 'ObjectPattern':
      return (target.properties as Node[]).flatMap((property) =>
        patternTargets(
          property.type === 'RestElement'
            ? (property.argument as Node)
            : (property.value as Node)
        )
      )
    case 'ArrayPattern':
      return (target.elements as Array<Node | null>)
        .filter((element): element is Node => Boolean(element))
        .flatMap(patternTargets)
    case 'AssignmentPattern':
      return patternTargets(target.left as Node)
    case 'RestElement':
      return patternTargets(target.argument as Node)
    default:
      return [target]
  }
}

function parse(source: string): Node | undefined {
  for (const sourceType of ['module', 'script'] as const) {
    try {
      return acorn.parse(source, {
        ecmaVersion: 'latest',
        sourceType,
        locations: true,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowImportExportEverywhere: true,
        allowHashBang: true
      }) as unknown as Node
    } catch {
      // Try the next source type
    }
  }

  return undefined
}

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node)

  for (const key of Object.keys(node)) {
    const value = node[key]
    const children = Array.isArray(value) ? value : [value]

    for (const child of children) {
      if (child && typeof (child as Node).type === 'string') {
        walk(child as Node, visit)
      }
    }
  }
}

// The build replaces process.env.NAME and import.meta.env.NAME with their
// values, which leaves a write as `"value" = x`. The env object is wrapped as
// (0, process.env) so the write reaches it instead and the module still parses.
export function keepEnvWrites(source: string): {
  code: string
  writes: EnvWrite[]
} {
  if (!MAY_WRITE_ENV.test(source)) return {code: source, writes: []}

  const ast = parse(source)
  if (!ast) return {code: source, writes: []}

  const objects = new Map<number, Node>()
  const writes: EnvWrite[] = []
  // Starts of statements that follow another in a list, where a line that
  // opens with "(" would call the line before it.
  const listedStatements = new Set<number>()

  walk(ast, (node) => {
    const list =
      node.type === 'SwitchCase'
        ? node.consequent
        : /^(?:Program|BlockStatement|StaticBlock)$/.test(node.type)
          ? node.body
          : undefined

    for (const statement of Array.isArray(list) ? (list as Node[]) : []) {
      if (statement.type === 'ExpressionStatement') {
        listedStatements.add(statement.start)
      }
    }

    for (const target of writeTargets(node).flatMap(patternTargets)) {
      if (target.type !== 'MemberExpression') continue

      const object = target.object as Node
      if (!isEnvObject(object)) continue

      objects.set(object.start, object)

      const name = envKey(target)

      if (name) {
        writes.push({
          name,
          read: `${source.slice(object.start, object.end)}.${name}`,
          line: target.loc?.start.line ?? 0
        })
      }
    }
  })

  if (objects.size === 0) return {code: source, writes: []}

  let code = source

  for (const object of [...objects.values()].sort(
    (a, b) => b.start - a.start
  )) {
    const guard = listedStatements.has(object.start) ? ';' : ''

    code =
      code.slice(0, object.start) +
      `${guard}(0,${code.slice(object.start, object.end)})` +
      code.slice(object.end)
  }

  return {code, writes}
}

const NODE_MODULES = /[\\/]node_modules[\\/]/

export default function envWriteLoader(
  this: EnvWriteLoaderContext,
  source: string,
  map?: unknown,
  meta?: unknown
): void {
  const {code, writes} = keepEnvWrites(source)

  // A dependency is not the author's to change, so only project code is told
  // that its reads keep the build value.
  if (!NODE_MODULES.test(this.resourcePath || '')) {
    const defined = new Set(this.getOptions()?.names || [])
    const replaced = writes.filter((write) => defined.has(write.name))

    if (replaced.length > 0) {
      // The bundler names the module beside the message, so the lines do not.
      const warning = new Error(messages.envDefinedNameWritten(replaced))
      warning.name = 'EnvDefinedNameWritten'
      this.emitWarning(warning)
    }
  }

  // The wrap adds four characters on the written line only, so the incoming
  // map still points every line at its source.
  this.callback(null, code, map, meta)
}
