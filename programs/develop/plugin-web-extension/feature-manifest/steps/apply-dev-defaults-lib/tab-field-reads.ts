// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {createRequire} from 'node:module'
import * as path from 'node:path'
import {experiments} from '@rspack/core'

const requireModule = createRequire(import.meta.url)

export interface TabFieldRead {
  line: number
  field: string
}

interface GeneratedRead extends TabFieldRead {
  column: number
}

type Kind = 'tab' | 'tabs' | 'window' | 'windows'

interface Node {
  type: string
  loc?: {start: {line: number; column: number}}
  [key: string]: unknown
}

const GATED_FIELDS = new Set(['url', 'pendingUrl', 'title', 'favIconUrl'])
const QUERY_FILTERS = new Set(['url', 'title'])

const TAB_METHODS: Record<string, Kind> = {
  query: 'tabs',
  getAllInWindow: 'tabs',
  get: 'tab',
  getCurrent: 'tab',
  getSelected: 'tab',
  create: 'tab',
  update: 'tab',
  duplicate: 'tab'
}

const WINDOW_METHODS: Record<string, Kind> = {
  getAll: 'windows',
  get: 'window',
  getCurrent: 'window',
  getLastFocused: 'window',
  create: 'window',
  update: 'window'
}

const TAB_EVENTS: Record<string, Record<number, Kind>> = {
  onUpdated: {1: 'tab', 2: 'tab'},
  onCreated: {0: 'tab'}
}

const WINDOW_EVENTS: Record<string, Record<number, Kind>> = {
  onCreated: {0: 'window'}
}

const ELEMENT_METHODS = new Set(['find', 'findLast', 'at', 'pop', 'shift'])
const LIST_METHODS = new Set([
  'filter',
  'slice',
  'concat',
  'reverse',
  'sort',
  'toSorted',
  'toReversed',
  'flat'
])
const ITERATING_METHODS = new Set([
  'map',
  'forEach',
  'filter',
  'find',
  'findLast',
  'findIndex',
  'findLastIndex',
  'some',
  'every',
  'flatMap',
  'sort',
  'toSorted'
])

const SKIPPED_KEYS = new Set(['type', 'loc', 'start', 'end', 'range'])

class Scope {
  readonly bindings = new Map<string, Kind>()

  constructor(readonly parent?: Scope) {}

  lookup(name: string): Kind | undefined {
    return this.bindings.get(name) ?? this.parent?.lookup(name)
  }

  owner(name: string): Scope {
    if (this.bindings.has(name) || !this.parent) return this

    return this.parent.owner(name)
  }
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Node).type === 'string'
  )
}

function propertyName(node: Node): string | undefined {
  const property = node.property as Node

  if (!node.computed && property.type === 'Identifier') {
    return property.name as string
  }

  if (property.type === 'Literal' && typeof property.value === 'string') {
    return property.value
  }

  return undefined
}

function keyName(node: Node): string | undefined {
  const key = node.key as Node

  if (!node.computed && key.type === 'Identifier') return key.name as string
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value

  return undefined
}

function isApiRoot(node: Node): boolean {
  if (node.type === 'Identifier') {
    return node.name === 'chrome' || node.name === 'browser'
  }

  if (node.type === 'MemberExpression') {
    const object = node.object as Node
    const name = propertyName(node)

    return (
      (name === 'chrome' || name === 'browser') &&
      object.type === 'Identifier' &&
      (object.name === 'globalThis' ||
        object.name === 'window' ||
        object.name === 'self')
    )
  }

  return false
}

function namespaceOf(node: Node): 'tabs' | 'windows' | undefined {
  if (node.type !== 'MemberExpression') return undefined

  const name = propertyName(node)

  if (
    (name === 'tabs' || name === 'windows') &&
    isApiRoot(node.object as Node)
  ) {
    return name
  }

  return undefined
}

function apiCall(
  callee: Node
): {namespace: 'tabs' | 'windows'; method: string} | undefined {
  if (callee.type !== 'MemberExpression') return undefined

  const namespace = namespaceOf(callee.object as Node)
  const method = propertyName(callee)

  return namespace && method ? {namespace, method} : undefined
}

function eventListener(
  callee: Node
): {namespace: 'tabs' | 'windows'; event: string} | undefined {
  if (callee.type !== 'MemberExpression') return undefined
  if (propertyName(callee) !== 'addListener') return undefined

  const event = callee.object as Node
  if (event.type !== 'MemberExpression') return undefined

  const namespace = namespaceOf(event.object as Node)
  const name = propertyName(event)

  return namespace && name ? {namespace, event: name} : undefined
}

function isFunction(node: Node): boolean {
  return (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression' ||
    node.type === 'FunctionDeclaration'
  )
}

function unwrap(node: Node): Node {
  if (node.type === 'ChainExpression') return unwrap(node.expression as Node)

  if (node.type === 'ParenthesizedExpression') {
    return unwrap(node.expression as Node)
  }

  return node
}

class Scanner {
  readonly reads: GeneratedRead[] = []
  readonly preBound = new WeakMap<Node, Map<string, Kind>>()
  readonly setters = new Map<string, string>()
  readonly promoted = new Map<string, Kind>()
  private scope = new Scope()

  constructor(promoted: ReadonlyMap<string, Kind>) {
    for (const [name, kind] of promoted) this.scope.bindings.set(name, kind)
  }

  kindOf(input: Node | null | undefined): Kind | undefined {
    if (!input) return undefined

    const node = unwrap(input)

    switch (node.type) {
      case 'Identifier':
        return this.scope.lookup(node.name as string)
      case 'AwaitExpression':
        return this.kindOf(node.argument as Node)
      case 'ConditionalExpression':
        return (
          this.kindOf(node.consequent as Node) ??
          this.kindOf(node.alternate as Node)
        )
      case 'LogicalExpression':
        return this.kindOf(node.left as Node) ?? this.kindOf(node.right as Node)
      case 'CallExpression':
        return this.callKind(node)
      case 'MemberExpression':
        return this.memberKind(node)
      default:
        return undefined
    }
  }

  private callKind(node: Node): Kind | undefined {
    const callee = unwrap(node.callee as Node)
    const api = apiCall(callee)

    if (api) {
      const table = api.namespace === 'tabs' ? TAB_METHODS : WINDOW_METHODS

      return table[api.method]
    }

    if (callee.type !== 'MemberExpression') return undefined

    const method = propertyName(callee)
    const objectKind = this.kindOf(callee.object as Node)

    if (method === 'then' || method === 'catch' || method === 'finally') {
      return objectKind
    }

    if (objectKind === 'tabs' && method) {
      if (ELEMENT_METHODS.has(method)) return 'tab'
      if (LIST_METHODS.has(method)) return 'tabs'
    }

    if (objectKind === 'windows' && method) {
      if (ELEMENT_METHODS.has(method)) return 'window'
      if (LIST_METHODS.has(method)) return 'windows'
    }

    return undefined
  }

  private memberKind(node: Node): Kind | undefined {
    const objectKind = this.kindOf(node.object as Node)
    if (!objectKind) return undefined

    const name = propertyName(node)

    if (objectKind === 'window' && name === 'tabs') return 'tabs'

    if (node.computed && name === undefined) {
      if (objectKind === 'tabs') return 'tab'
      if (objectKind === 'windows') return 'window'
    }

    return undefined
  }

  private read(node: Node, field: string): void {
    const start = node.loc?.start

    if (start) this.reads.push({line: start.line, column: start.column, field})
  }

  private bindPattern(pattern: Node, kind: Kind | undefined): void {
    if (!kind) return

    switch (pattern.type) {
      case 'Identifier':
        this.scope.bindings.set(pattern.name as string, kind)

        return
      case 'AssignmentPattern':
        this.bindPattern(pattern.left as Node, kind)

        return

      case 'ArrayPattern': {
        const element =
          kind === 'tabs' ? 'tab' : kind === 'windows' ? 'window' : undefined

        for (const item of pattern.elements as Array<Node | null>) {
          if (!item) continue

          if (item.type === 'RestElement') {
            this.bindPattern(item.argument as Node, kind)
          } else {
            this.bindPattern(item, element)
          }
        }

        return
      }

      case 'ObjectPattern':
        for (const property of pattern.properties as Node[]) {
          if (property.type === 'RestElement') {
            this.bindPattern(property.argument as Node, kind)
            continue
          }

          const name = keyName(property)

          if (kind === 'tab' && name && GATED_FIELDS.has(name)) {
            this.read(property, name)
          } else if (kind === 'window' && name === 'tabs') {
            this.bindPattern(property.value as Node, 'tabs')
          }
        }

        return
      default:
        return
    }
  }

  private preBind(fn: Node | undefined, kinds: Record<number, Kind>): void {
    if (!fn || !isFunction(fn)) return

    const params = fn.params as Node[]
    const map = this.preBound.get(fn) ?? new Map<string, Kind>()

    for (const [index, kind] of Object.entries(kinds)) {
      const param = params[Number(index)]
      if (!param) continue

      if (param.type === 'Identifier') {
        map.set(param.name as string, kind)
      } else {
        map.set(`\u0000${index}`, kind)
      }
    }

    this.preBound.set(fn, map)
  }

  private lastFunctionArgument(node: Node): Node | undefined {
    const args = node.arguments as Node[]
    const last = args[args.length - 1]

    return last && isFunction(last) ? last : undefined
  }

  private noteCall(node: Node): void {
    const callee = unwrap(node.callee as Node)
    const api = apiCall(callee)
    const args = node.arguments as Node[]

    if (api) {
      const table = api.namespace === 'tabs' ? TAB_METHODS : WINDOW_METHODS
      const kind = table[api.method]

      if (kind) this.preBind(this.lastFunctionArgument(node), {0: kind})

      if (api.namespace === 'tabs' && api.method === 'query') {
        const filter = args[0] ? unwrap(args[0]) : undefined

        if (filter?.type === 'ObjectExpression') {
          for (const property of filter.properties as Node[]) {
            if (property.type !== 'Property') continue

            const name = keyName(property)

            if (name && QUERY_FILTERS.has(name)) this.read(property, name)
          }
        }
      }

      return
    }

    const listener = eventListener(callee)

    if (listener) {
      const table = listener.namespace === 'tabs' ? TAB_EVENTS : WINDOW_EVENTS
      const kinds = table[listener.event]

      if (kinds) this.preBind(args[0], kinds)

      return
    }

    if (callee.type === 'MemberExpression') {
      const method = propertyName(callee)
      const objectKind = this.kindOf(callee.object as Node)

      if (method === 'then' && objectKind) {
        this.preBind(args[0], {0: objectKind})
      } else if (method && ITERATING_METHODS.has(method)) {
        if (objectKind === 'tabs') this.preBind(args[0], {0: 'tab', 1: 'tab'})
        if (objectKind === 'windows') this.preBind(args[0], {0: 'window'})
      } else if (method === 'reduce' && objectKind === 'tabs') {
        this.preBind(args[0], {1: 'tab'})
      }

      return
    }

    if (callee.type === 'Identifier') {
      const state = this.setters.get(callee.name as string)
      if (!state) return

      const argument = args[0] ? unwrap(args[0]) : undefined
      const kind =
        argument && isFunction(argument)
          ? this.kindOf(argument.body as Node)
          : this.kindOf(argument)

      if (kind) this.promoted.set(state, kind)
    }
  }

  private noteDeclarator(node: Node): void {
    const id = node.id as Node
    const init = node.init ? unwrap(node.init as Node) : undefined

    if (
      init?.type === 'CallExpression' &&
      (init.callee as Node).type === 'Identifier' &&
      (init.callee as Node).name === 'useState' &&
      id.type === 'ArrayPattern'
    ) {
      const [state, setter] = id.elements as Array<Node | null>

      if (state?.type === 'Identifier' && setter?.type === 'Identifier') {
        this.setters.set(setter.name as string, state.name as string)
      }
    }

    this.bindPattern(id, this.kindOf(init))
  }

  private enterFunction(node: Node): void {
    const pre = this.preBound.get(node)
    const params = node.params as Node[]

    params.forEach((param, index) => {
      const target =
        param.type === 'AssignmentPattern' ? (param.left as Node) : param
      const kind =
        pre?.get(`\u0000${String(index)}`) ??
        (target.type === 'Identifier'
          ? pre?.get(target.name as string)
          : undefined)

      if (kind) this.bindPattern(target, kind)
    })
  }

  visit(node: Node): void {
    switch (node.type) {
      case 'Program':
      case 'BlockStatement':
      case 'StaticBlock':
      case 'CatchClause':
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':

      case 'SwitchStatement': {
        this.scope = new Scope(this.scope)

        if (node.type === 'ForOfStatement') {
          const right = node.right as Node
          this.visit(right)
          const left = node.left as Node
          const listKind = this.kindOf(right)
          const element =
            listKind === 'tabs'
              ? 'tab'
              : listKind === 'windows'
                ? 'window'
                : undefined

          if (left.type === 'VariableDeclaration') {
            for (const declarator of left.declarations as Node[]) {
              this.bindPattern(declarator.id as Node, element)
            }
          } else {
            this.bindPattern(left, element)
          }

          this.visit(node.body as Node)
        } else {
          this.visitChildren(node)
        }

        this.scope = this.scope.parent as Scope

        return
      }

      case 'ArrowFunctionExpression':
      case 'FunctionExpression':

      case 'FunctionDeclaration': {
        this.scope = new Scope(this.scope)
        this.enterFunction(node)
        this.visitChildren(node)
        this.scope = this.scope.parent as Scope

        return
      }

      case 'VariableDeclarator':
        if (node.init) this.visit(node.init as Node)

        this.noteDeclarator(node)

        return

      case 'AssignmentExpression': {
        this.visit(node.right as Node)
        const left = node.left as Node

        if (left.type === 'Identifier') {
          const kind = this.kindOf(node.right as Node)

          if (kind) {
            this.scope
              .owner(left.name as string)
              .bindings.set(left.name as string, kind)
          }
        } else {
          this.visit(left)
        }

        return
      }

      case 'CallExpression':
        this.noteCall(node)
        this.visitChildren(node)

        return

      case 'MemberExpression': {
        const name = propertyName(node)

        if (
          name &&
          GATED_FIELDS.has(name) &&
          this.kindOf(node.object as Node) === 'tab'
        ) {
          this.read(node, name)
        }

        this.visitChildren(node)

        return
      }

      default:
        this.visitChildren(node)
    }
  }

  private visitChildren(node: Node): void {
    for (const [key, value] of Object.entries(node)) {
      if (SKIPPED_KEYS.has(key)) continue

      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) this.visit(item)
      } else if (isNode(value)) {
        this.visit(value)
      }
    }
  }
}

function parseScript(source: string): Node | undefined {
  const acorn = requireModule('acorn')
  const shared = {
    ecmaVersion: 'latest',
    locations: true,
    allowAwaitOutsideFunction: true,
    allowHashBang: true,
    allowReturnOutsideFunction: true
  }

  for (const sourceType of ['module', 'script']) {
    try {
      return acorn.parse(source, {...shared, sourceType}) as Node
    } catch {
      /* @invariant the other source type gets its turn */
    }
  }

  return undefined
}

const VLQ_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function decodeSegment(segment: string): number[] {
  const values: number[] = []
  let shift = 0
  let value = 0

  for (const char of segment) {
    const digit = VLQ_CHARS.indexOf(char)
    if (digit < 0) return values

    value += (digit & 31) << shift

    if (digit & 32) {
      shift += 5
    } else {
      const negative = value & 1
      value >>= 1
      values.push(negative ? -value : value)
      value = 0
      shift = 0
    }
  }

  return values
}

export function sourceLineOf(
  mappings: string,
  generatedLine: number,
  generatedColumn: number
): number | undefined {
  let sourceLine = 0
  let sourceIndex = 0
  const lines = mappings.split(';')

  for (let index = 0; index < lines.length; index++) {
    let generated = 0
    let best: number | undefined

    for (const segment of lines[index].split(',')) {
      if (!segment) continue

      const fields = decodeSegment(segment)
      generated += fields[0] ?? 0

      if (fields.length >= 4) {
        sourceIndex += fields[1]
        sourceLine += fields[2]

        if (index + 1 === generatedLine && sourceIndex === 0) {
          if (generated <= generatedColumn || best === undefined) {
            best = sourceLine + 1
          }
        }
      }
    }

    if (index + 1 === generatedLine) return best
  }

  return undefined
}

function parserOptions(filename: string) {
  const extension = path.extname(filename).toLowerCase()

  if (['.ts', '.mts', '.cts'].includes(extension)) {
    return {syntax: 'typescript', tsx: false, decorators: true}
  }

  if (extension === '.tsx') {
    return {syntax: 'typescript', tsx: true, decorators: true}
  }

  if (['.js', '.mjs', '.cjs', '.jsx'].includes(extension)) {
    return {syntax: 'ecmascript', jsx: true, decorators: true}
  }

  return undefined
}

interface Lowered {
  ast: Node
  lineOf: (line: number, column: number) => number | undefined
}

function lower(source: string, filename: string): Lowered | undefined {
  const extension = path.extname(filename).toLowerCase()

  if (['.js', '.mjs', '.cjs'].includes(extension)) {
    const ast = parseScript(source)
    if (ast) return {ast, lineOf: (line) => line}
  }

  const parser = parserOptions(filename)
  if (!parser) return undefined

  try {
    const output = experiments?.swc?.transformSync(source, {
      filename: path.basename(filename),
      jsc: {
        parser,
        target: 'es2022',
        transform: {react: {runtime: 'automatic'}}
      },
      sourceMaps: true,
      minify: false
    } as never) as {code?: string; map?: string} | undefined

    if (!output || typeof output.code !== 'string') return undefined

    const ast = parseScript(output.code)
    if (!ast) return undefined

    const mappings =
      typeof output.map === 'string'
        ? (JSON.parse(output.map) as {mappings?: string}).mappings
        : undefined

    return {
      ast,
      lineOf: (line, column) =>
        mappings ? sourceLineOf(mappings, line, column) : undefined
    }
  } catch {
    return undefined
  }
}

export function findTabFieldReads(
  source: string,
  filename: string
): TabFieldRead[] | undefined {
  const lowered = lower(source, filename)
  if (!lowered) return undefined

  let promoted = new Map<string, Kind>()
  let scanner = new Scanner(promoted)
  scanner.visit(lowered.ast)

  for (let pass = 0; pass < 3; pass++) {
    const grown = [...scanner.promoted].some(
      ([name, kind]) => promoted.get(name) !== kind
    )

    if (!grown) break

    promoted = new Map([...promoted, ...scanner.promoted])
    scanner = new Scanner(promoted)
    scanner.visit(lowered.ast)
  }

  const seen = new Set<string>()
  const reads: TabFieldRead[] = []

  for (const read of scanner.reads) {
    const line = lowered.lineOf(read.line, read.column)
    if (!line) continue

    const key = `${String(line)}:${read.field}`
    if (seen.has(key)) continue

    seen.add(key)
    reads.push({line, field: read.field})
  }

  return reads.sort((a, b) => a.line - b.line)
}
