// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {
  type AstNode,
  children,
  isNode,
  list,
  node,
  parse
} from '../../../../plugin-compatibility/compatibility-lib/free-browser-references'

// The spans of a script Safari never executes: a branch that a presence check
// on a missing namespace or member keeps closed, the rest of a block after an
// early exit on the same check, a try block whose catch absorbs the throw, and
// the body of a function reached from those spans only. A call inside one of
// them cannot throw on Safari, so the unsupported-API scan leaves it alone.

export interface Range {
  start: number
  end: number
}

export interface WebkitMissingApis {
  namespaces: ReadonlySet<string>
  // api.member for a member Safari lacks on a namespace it ships
  members: ReadonlySet<string>
}

const MAX_PARSE_BYTES = 4 * 1024 * 1024
const GLOBAL_OBJECTS = new Set(['globalThis', 'self', 'window'])
const EXTENSION_ROOTS = new Set(['chrome', 'browser'])

type Truth = 'true' | 'false' | undefined

interface FunctionReference {
  offset: number
  enclosing: string[]
}

interface NamedFunction {
  body: Range
  references: FunctionReference[]
  exported: boolean
}

function negate(value: Truth): Truth {
  if (value === 'true') return 'false'
  if (value === 'false') return 'true'

  return undefined
}

function propertyName(member: AstNode): string | undefined {
  const property = node(member.property)
  if (!property) return undefined

  if (!member.computed && property.type === 'Identifier') {
    return String(property.name)
  }

  if (property.type === 'Literal' && typeof property.value === 'string') {
    return property.value
  }

  return undefined
}

// chrome.offscreen, globalThis.chrome?.offscreen, browser.runtime.getContexts
// all read as [chrome, offscreen] or [browser, runtime, getContexts].
function memberPath(value: AstNode): string[] | undefined {
  let current: AstNode | undefined = value
  const names: string[] = []

  while (current) {
    if (current.type === 'ChainExpression') {
      current = node(current.expression)
      continue
    }

    if (current.type === 'MemberExpression') {
      const name = propertyName(current)
      if (name === undefined) return undefined

      names.unshift(name)
      current = node(current.object)
      continue
    }

    if (current.type === 'Identifier') {
      names.unshift(String(current.name))
      break
    }

    return undefined
  }

  if (names.length && GLOBAL_OBJECTS.has(names[0])) names.shift()

  return names.length && EXTENSION_ROOTS.has(names[0]) ? names : undefined
}

function namesMissingApi(path: string[], missing: WebkitMissingApis) {
  if (path.length < 2) return false
  if (missing.namespaces.has(path[1])) return true

  return path.length >= 3 && missing.members.has(`${path[1]}.${path[2]}`)
}

function readsMissingApi(value: AstNode, missing: WebkitMissingApis) {
  const path = memberPath(value)

  return path !== undefined && namesMissingApi(path, missing)
}

function isUndefinedLiteral(value: AstNode | undefined): boolean {
  if (!value) return false
  if (value.type === 'Identifier' && value.name === 'undefined') return true

  return (
    value.type === 'UnaryExpression' &&
    value.operator === 'void' &&
    node(value.argument)?.type === 'Literal'
  )
}

function isNullLiteral(value: AstNode | undefined): boolean {
  return value?.type === 'Literal' && value.value === null
}

function typeofMissingApi(value: AstNode, missing: WebkitMissingApis) {
  return (
    value.type === 'UnaryExpression' &&
    value.operator === 'typeof' &&
    isNode(value.argument) &&
    readsMissingApi(value.argument, missing)
  )
}

function compared(
  left: AstNode,
  right: AstNode,
  operator: string,
  missing: WebkitMissingApis
): Truth {
  const equals = operator === '===' || operator === '=='
  const differs = operator === '!==' || operator === '!='
  if (!equals && !differs) return undefined

  // typeof chrome.offscreen is the string "undefined" on Safari
  if (typeofMissingApi(left, missing) && right.type === 'Literal') {
    const same = right.value === 'undefined'

    return equals === same ? 'true' : 'false'
  }

  if (!readsMissingApi(left, missing)) return undefined

  if (isUndefinedLiteral(right)) return equals ? 'true' : 'false'

  if (isNullLiteral(right)) {
    const loose = operator === '==' || operator === '!='
    if (!loose) return equals ? 'false' : 'true'

    return equals ? 'true' : 'false'
  }

  return undefined
}

// What the test evaluates to on Safari, where every missing namespace and
// member reads as undefined, or undefined when nothing here decides it.
function truthOnSafari(
  test: AstNode | undefined,
  missing: WebkitMissingApis
): Truth {
  if (!test) return undefined

  switch (test.type) {
    case 'ChainExpression':
    case 'MemberExpression':
      return readsMissingApi(test, missing) ? 'false' : undefined
    case 'UnaryExpression':
      if (test.operator === '!') {
        return negate(truthOnSafari(node(test.argument), missing))
      }

      return undefined

    case 'CallExpression': {
      const callee = node(test.callee)
      const argument = list(test.arguments)[0]

      return callee?.type === 'Identifier' &&
        callee.name === 'Boolean' &&
        argument
        ? truthOnSafari(argument, missing)
        : undefined
    }

    case 'BinaryExpression': {
      const left = node(test.left)
      const right = node(test.right)
      if (!left || !right) return undefined

      if (test.operator === 'in') {
        const path = memberPath(right)

        if (left.type !== 'Literal' || typeof left.value !== 'string') {
          return undefined
        }

        return path && namesMissingApi([...path, left.value], missing)
          ? 'false'
          : undefined
      }

      return (
        compared(left, right, String(test.operator), missing) ??
        compared(right, left, String(test.operator), missing)
      )
    }

    case 'LogicalExpression': {
      const left = truthOnSafari(node(test.left), missing)
      const right = truthOnSafari(node(test.right), missing)

      if (test.operator === '&&') {
        if (left === 'false' || right === 'false') return 'false'

        return left === 'true' && right === 'true' ? 'true' : undefined
      }

      if (test.operator === '||') {
        if (left === 'true' || right === 'true') return 'true'

        return left === 'false' && right === 'false' ? 'false' : undefined
      }

      return undefined
    }

    default:
      return undefined
  }
}

function exitsAbruptly(statement: AstNode | undefined): boolean {
  if (!statement) return false

  switch (statement.type) {
    case 'ReturnStatement':
    case 'ThrowStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return true
    case 'BlockStatement':
      return list(statement.body).some((item) => exitsAbruptly(item))
    case 'IfStatement':
      return (
        exitsAbruptly(node(statement.consequent)) &&
        exitsAbruptly(node(statement.alternate))
      )
    default:
      return false
  }
}

function rangeOf(value: AstNode | undefined): Range | undefined {
  if (!value) return undefined

  return {start: Number(value.start), end: Number(value.end)}
}

function functionBody(value: AstNode): Range | undefined {
  return rangeOf(node(value.body))
}

function isFunctionNode(value: AstNode | undefined): boolean {
  return (
    value?.type === 'FunctionDeclaration' ||
    value?.type === 'FunctionExpression' ||
    value?.type === 'ArrowFunctionExpression'
  )
}

class GuardedRangeScan {
  public readonly ranges: Range[] = []
  public readonly functions = new Map<string, NamedFunction>()
  private readonly pending: {name: string; reference: FunctionReference}[] = []

  constructor(
    program: AstNode,
    private readonly missing: WebkitMissingApis
  ) {
    this.visit(program, [])
  }

  private closed(test: AstNode | undefined): boolean {
    return truthOnSafari(test, this.missing) === 'false'
  }

  private open(test: AstNode | undefined): boolean {
    return truthOnSafari(test, this.missing) === 'true'
  }

  private add(range: Range | undefined): void {
    if (range) this.ranges.push(range)
  }

  private declare(name: string, fn: AstNode, exported: boolean): void {
    const body = functionBody(fn)
    if (!body) return

    const known = this.functions.get(name)

    if (known) {
      // Two declarations share a name, so neither can vouch for the other
      known.exported = true

      return
    }

    this.functions.set(name, {body, references: [], exported})
  }

  private refer(name: string, offset: number, enclosing: string[]): void {
    const known = this.functions.get(name)
    const reference = {offset, enclosing: [...enclosing]}

    if (known) {
      known.references.push(reference)

      return
    }

    this.pending.push({name, reference})
  }

  public settle(): void {
    for (const {name, reference} of this.pending) {
      this.functions.get(name)?.references.push(reference)
    }
  }

  private visitStatements(statements: AstNode[], enclosing: string[]): void {
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index]
      this.visit(statement, enclosing)

      // if (!chrome.offscreen) return: everything after it needs the namespace
      if (
        statement.type === 'IfStatement' &&
        this.open(node(statement.test)) &&
        exitsAbruptly(node(statement.consequent)) &&
        index + 1 < statements.length
      ) {
        this.add({
          start: Number(statements[index + 1].start),
          end: Number(statements[statements.length - 1].end)
        })
      }
    }
  }

  private visitDeclarator(
    declarator: AstNode,
    enclosing: string[],
    exported: boolean
  ): void {
    const id = node(declarator.id)
    const init = node(declarator.init)

    if (id?.type === 'Identifier' && isFunctionNode(init)) {
      this.declare(String(id.name), init as AstNode, exported)
      this.visit(init, [...enclosing, String(id.name)])

      return
    }

    if (id?.type !== 'Identifier') this.visit(id, enclosing)

    this.visit(init, enclosing)
  }

  private visitDeclaration(
    declaration: AstNode,
    enclosing: string[],
    exported: boolean
  ): void {
    if (declaration.type === 'FunctionDeclaration') {
      const name = node(declaration.id)?.name

      if (typeof name === 'string') {
        this.declare(name, declaration, exported)
        this.visit(node(declaration.body), [...enclosing, name])

        return
      }
    }

    if (declaration.type === 'VariableDeclaration') {
      for (const declarator of list(declaration.declarations)) {
        this.visitDeclarator(declarator, enclosing, exported)
      }

      return
    }

    this.visit(declaration, enclosing)
  }

  private visit(current: AstNode | undefined, enclosing: string[]): void {
    if (!current) return

    switch (current.type) {
      case 'Program':
      case 'BlockStatement':
      case 'StaticBlock':
        this.visitStatements(list(current.body), enclosing)

        return
      case 'FunctionDeclaration':
      case 'VariableDeclaration':
        this.visitDeclaration(current, enclosing, false)

        return
      case 'ExportNamedDeclaration':

      case 'ExportDefaultDeclaration': {
        const declaration = node(current.declaration)
        if (declaration) this.visitDeclaration(declaration, enclosing, true)

        for (const specifier of list(current.specifiers)) {
          const local = node(specifier.local)

          if (local?.type === 'Identifier') {
            this.refer(String(local.name), Number(local.start), [])
          }
        }

        return
      }

      case 'IfStatement': {
        const test = node(current.test)
        this.visit(test, enclosing)
        if (this.closed(test)) this.add(rangeOf(node(current.consequent)))
        if (this.open(test)) this.add(rangeOf(node(current.alternate)))

        this.visit(node(current.consequent), enclosing)
        this.visit(node(current.alternate), enclosing)

        return
      }

      case 'ConditionalExpression': {
        const test = node(current.test)
        this.visit(test, enclosing)
        if (this.closed(test)) this.add(rangeOf(node(current.consequent)))
        if (this.open(test)) this.add(rangeOf(node(current.alternate)))

        this.visit(node(current.consequent), enclosing)
        this.visit(node(current.alternate), enclosing)

        return
      }

      case 'LogicalExpression': {
        const left = node(current.left)
        this.visit(left, enclosing)

        if (
          (current.operator === '&&' && this.closed(left)) ||
          (current.operator === '||' && this.open(left))
        ) {
          this.add(rangeOf(node(current.right)))
        }

        this.visit(node(current.right), enclosing)

        return
      }

      case 'WhileStatement':

      case 'ForStatement': {
        const test = node(current.test)
        this.visit(node(current.init), enclosing)
        this.visit(test, enclosing)
        if (this.closed(test)) this.add(rangeOf(node(current.body)))

        this.visit(node(current.update), enclosing)
        this.visit(node(current.body), enclosing)

        return
      }

      case 'TryStatement':
        if (node(current.handler)) this.add(rangeOf(node(current.block)))

        this.visit(node(current.block), enclosing)
        this.visit(node(current.handler), enclosing)
        this.visit(node(current.finalizer), enclosing)

        return
      case 'MemberExpression':
        this.visit(node(current.object), enclosing)
        if (current.computed) this.visit(node(current.property), enclosing)

        return
      case 'Property':
      case 'MethodDefinition':
      case 'PropertyDefinition':
        if (current.computed) this.visit(node(current.key), enclosing)

        this.visit(node(current.value), enclosing)

        return
      case 'LabeledStatement':
        this.visit(node(current.body), enclosing)

        return
      case 'Identifier':
        this.refer(String(current.name), Number(current.start), enclosing)

        return
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'MetaProperty':
      case 'BreakStatement':
      case 'ContinueStatement':
        return
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        for (const param of list(current.params)) this.visit(param, enclosing)

        this.visit(node(current.body), enclosing)

        return
      default:
        for (const child of children(current)) this.visit(child, enclosing)
    }
  }
}

function covers(ranges: Range[], offset: number): boolean {
  return ranges.some((range) => offset >= range.start && offset < range.end)
}

// A function is unreachable on Safari when something refers to it and every
// reference sits in a span Safari skips, including another such function.
function settleFunctions(scan: GuardedRangeScan): Range[] {
  const ranges = [...scan.ranges]
  const guarded = new Set<string>()
  let changed = true

  while (changed) {
    changed = false

    for (const [name, fn] of scan.functions) {
      if (guarded.has(name) || fn.exported) continue

      const entries = fn.references.filter(
        (reference) => !reference.enclosing.includes(name)
      )
      if (!entries.length) continue

      const unreachable = entries.every(
        (reference) =>
          covers(ranges, reference.offset) ||
          reference.enclosing.some((outer) => guarded.has(outer))
      )
      if (!unreachable) continue

      guarded.add(name)
      ranges.push(fn.body)
      changed = true
    }
  }

  return ranges
}

export function webkitGuardedRanges(
  source: string,
  missing: WebkitMissingApis
): Range[] {
  if (source.length > MAX_PARSE_BYTES) return []

  const program = parse(source)
  if (!program) return []

  try {
    const scan = new GuardedRangeScan(program, missing)
    scan.settle()

    return settleFunctions(scan)
  } catch {
    return []
  }
}

// True when the pattern matches somewhere Safari really runs. A match inside
// a guarded span is the author's own feature check doing its job.
export function matchesOutside(
  source: string,
  pattern: RegExp,
  ranges: Range[]
): boolean {
  const global = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  )

  for (
    let match = global.exec(source);
    match !== null;
    match = global.exec(source)
  ) {
    if (!covers(ranges, match.index)) return true
    if (match[0].length === 0) global.lastIndex += 1
  }

  return false
}
