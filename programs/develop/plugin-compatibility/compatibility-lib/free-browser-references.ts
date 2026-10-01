//  ██████╗ ██████╗ ███╗   ███╗██████╗  █████╗ ████████╗██╗██████╗ ██╗██╗     ██╗████████╗██╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██╔══██╗╚══██╔══╝██║██╔══██╗██║██║     ██║╚══██╔══╝╚██╗ ██╔╝
// ██║     ██║   ██║██╔████╔██║██████╔╝███████║   ██║   ██║██████╔╝██║██║     ██║   ██║    ╚████╔╝
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██╔══██║   ██║   ██║██╔══██╗██║██║     ██║   ██║     ╚██╔╝
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║  ██║   ██║   ██║██████╔╝██║███████╗██║   ██║      ██║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createRequire} from 'node:module'

const requireModule = createRequire(import.meta.url)

const GLOBAL_NAME = 'browser'
const GLOBAL_OBJECTS = new Set(['globalThis', 'self', 'window'])
const QUICK_RE = /(?<![\w$.])browser\b/
const NON_CHILD_KEYS = new Set(['type', 'start', 'end', 'loc', 'range'])

interface AstNode {
  type: string
  [key: string]: unknown
}

type Child = AstNode | AstNode[] | null | undefined

function isNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AstNode).type === 'string'
  )
}

function node(value: unknown): AstNode | undefined {
  return isNode(value) ? value : undefined
}

function list(value: unknown): AstNode[] {
  return Array.isArray(value) ? value.filter(isNode) : []
}

function isName(value: unknown): boolean {
  return isNode(value) && value.type === 'Identifier' && value.name === GLOBAL_NAME
}

function parse(source: string): AstNode | undefined {
  const acorn = requireModule('acorn')
  const shared = {
    ecmaVersion: 'latest',
    allowAwaitOutsideFunction: true,
    allowHashBang: true
  }

  try {
    return acorn.parse(source, {
      ...shared,
      sourceType: 'script',
      allowReturnOutsideFunction: true
    })
  } catch {
    // Ignore
  }

  try {
    return acorn.parse(source, {...shared, sourceType: 'module'})
  } catch {
    return undefined
  }
}

function patternDeclares(pattern: Child): boolean {
  if (!isNode(pattern)) return false

  switch (pattern.type) {
    case 'Identifier':
      return pattern.name === GLOBAL_NAME
    case 'ObjectPattern':
      return list(pattern.properties).some((property) =>
        patternDeclares(
          property.type === 'RestElement'
            ? (property.argument as Child)
            : (property.value as Child)
        )
      )
    case 'ArrayPattern':
      return list(pattern.elements).some((element) => patternDeclares(element))
    case 'AssignmentPattern':
      return patternDeclares(pattern.left as Child)
    case 'RestElement':
      return patternDeclares(pattern.argument as Child)
    default:
      return false
  }
}

function declarationDeclares(statement: AstNode): boolean {
  switch (statement.type) {
    case 'VariableDeclaration':
      return list(statement.declarations).some((declarator) =>
        patternDeclares(declarator.id as Child)
      )
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
      return isName(statement.id)
    case 'ImportDeclaration':
      return list(statement.specifiers).some((specifier) =>
        isName(specifier.local)
      )
    case 'ExportNamedDeclaration':
    case 'ExportDefaultDeclaration':
      return isNode(statement.declaration)
        ? declarationDeclares(statement.declaration)
        : false
    default:
      return false
  }
}

function isFunction(value: AstNode): boolean {
  return (
    value.type === 'FunctionDeclaration' ||
    value.type === 'FunctionExpression' ||
    value.type === 'ArrowFunctionExpression'
  )
}

function children(value: AstNode): AstNode[] {
  const out: AstNode[] = []

  for (const key of Object.keys(value)) {
    if (NON_CHILD_KEYS.has(key)) continue

    const child = value[key]

    if (Array.isArray(child)) {
      for (const item of child) if (isNode(item)) out.push(item)
    } else if (isNode(child)) {
      out.push(child)
    }
  }

  return out
}

function hoistedDeclares(statements: AstNode[]): boolean {
  const stack = [...statements]

  while (stack.length) {
    const current = stack.pop() as AstNode

    if (current.type === 'FunctionDeclaration') {
      if (isName(current.id)) return true

      continue
    }

    if (isFunction(current) || current.type.startsWith('Class')) continue

    if (current.type === 'VariableDeclaration' && current.kind === 'var') {
      if (declarationDeclares(current)) return true

      continue
    }

    stack.push(...children(current))
  }

  return false
}

function lexicalDeclares(statements: AstNode[]): boolean {
  return statements.some(
    (statement) =>
      !(statement.type === 'VariableDeclaration' && statement.kind === 'var') &&
      declarationDeclares(statement)
  )
}

function blockDeclares(body: Child): boolean {
  const block = node(body)
  if (!block || block.type !== 'BlockStatement') return false

  return hoistedDeclares(list(block.body)) || lexicalDeclares(list(block.body))
}

function functionDeclares(fn: AstNode): boolean {
  if (fn.type === 'FunctionExpression' && isName(fn.id)) return true
  if (list(fn.params).some((param) => patternDeclares(param))) return true

  return blockDeclares(fn.body as Child)
}

function loopDeclares(loop: AstNode): boolean {
  const head = node(loop.init) || node(loop.left)

  return head?.type === 'VariableDeclaration'
    ? declarationDeclares(head)
    : false
}

function isGlobalLookup(value: AstNode): boolean {
  if (value.type !== 'MemberExpression' || value.computed) return false

  const object = node(value.object)

  return (
    isName(value.property) &&
    object?.type === 'Identifier' &&
    GLOBAL_OBJECTS.has(String(object.name))
  )
}

// A `typeof browser` test, a `"browser" in globalThis` test or a read through
// the global object means the author expects the name to be missing.
function guardsName(test: Child): boolean {
  if (!isNode(test)) return false

  const stack = [test]

  while (stack.length) {
    const current = stack.pop() as AstNode

    if (
      current.type === 'UnaryExpression' &&
      current.operator === 'typeof' &&
      isName(current.argument)
    ) {
      return true
    }

    if (
      current.type === 'BinaryExpression' &&
      current.operator === 'in' &&
      node(current.left)?.type === 'Literal' &&
      node(current.left)?.value === GLOBAL_NAME
    ) {
      return true
    }

    if (isGlobalLookup(current)) return true

    stack.push(...children(current))
  }

  return false
}

class FreeReferenceScan {
  public found = false

  constructor(program: AstNode) {
    const body = list(program.body)
    this.visit(program, hoistedDeclares(body) || lexicalDeclares(body))
  }

  private visitAll(values: unknown, shadowed: boolean): void {
    for (const value of list(values)) this.visit(value, shadowed)
  }

  private visitClass(current: AstNode, shadowed: boolean): void {
    const inner =
      shadowed || (current.type === 'ClassExpression' && isName(current.id))
    this.visit(current.superClass as Child, inner)
    this.visit(current.body as Child, inner)
  }

  private visitSwitch(current: AstNode, shadowed: boolean): void {
    this.visit(current.discriminant as Child, shadowed)
    const cases = list(current.cases)
    const inner =
      shadowed || lexicalDeclares(cases.flatMap((item) => list(item.consequent)))

    for (const item of cases) {
      this.visit(item.test as Child, inner)
      this.visitAll(item.consequent, inner)
    }
  }

  private visitLoop(current: AstNode, shadowed: boolean): void {
    const inner = shadowed || loopDeclares(current)
    this.visit(current.init as Child, inner)
    this.visit(current.left as Child, inner)
    this.visit(current.right as Child, inner)
    this.visit(current.test as Child, inner)
    this.visit(current.update as Child, inner)
    this.visit(current.body as Child, inner)
  }

  private visit(current: Child, shadowed: boolean): void {
    if (this.found || !isNode(current)) return

    switch (current.type) {
      case 'Identifier':
        if (!shadowed && current.name === GLOBAL_NAME) this.found = true

        return
      case 'Program':
        this.visitAll(current.body, shadowed)

        return
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        this.visit(current.body as Child, shadowed || functionDeclares(current))

        return
      case 'ClassDeclaration':
      case 'ClassExpression':
        this.visitClass(current, shadowed)

        return
      case 'BlockStatement':
      case 'StaticBlock':
        this.visitAll(
          current.body,
          shadowed || lexicalDeclares(list(current.body))
        )

        return
      case 'SwitchStatement':
        this.visitSwitch(current, shadowed)

        return
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
        this.visitLoop(current, shadowed)

        return
      case 'CatchClause':
        this.visit(
          current.body as Child,
          shadowed || patternDeclares(current.param as Child)
        )

        return
      case 'VariableDeclarator':
        this.visit(current.init as Child, shadowed)

        return
      case 'AssignmentExpression':
        if (node(current.left)?.type !== 'Identifier') {
          this.visit(current.left as Child, shadowed)
        }

        this.visit(current.right as Child, shadowed)

        return
      case 'MemberExpression':
        this.visit(current.object as Child, shadowed)
        if (current.computed) this.visit(current.property as Child, shadowed)

        return
      case 'Property':
      case 'MethodDefinition':
      case 'PropertyDefinition':
        if (current.computed) this.visit(current.key as Child, shadowed)

        this.visit(current.value as Child, shadowed)

        return
      case 'UnaryExpression':
        if (current.operator === 'typeof' && isName(current.argument)) return

        this.visit(current.argument as Child, shadowed)

        return
      case 'IfStatement':
      case 'ConditionalExpression':
        this.visit(current.test as Child, shadowed)
        if (guardsName(current.test as Child)) return

        this.visit(current.consequent as Child, shadowed)
        this.visit(current.alternate as Child, shadowed)

        return
      case 'LogicalExpression':
        this.visit(current.left as Child, shadowed)
        if (guardsName(current.left as Child)) return

        this.visit(current.right as Child, shadowed)

        return
      case 'LabeledStatement':
        this.visit(current.body as Child, shadowed)

        return
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'ExportSpecifier':
      case 'MetaProperty':
        return
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration':
        this.visit(current.declaration as Child, shadowed)

        return
      default:
        for (const child of children(current)) this.visit(child, shadowed)
    }
  }
}

export function mentionsBrowserName(source: string): boolean {
  return QUICK_RE.test(source)
}

// True when the script reads `browser` as a free global: not a local binding,
// not a property of something, and not behind a check that it exists.
export function referencesBrowserGlobal(source: string): boolean {
  if (!mentionsBrowserName(source)) return false

  const program = parse(source)
  if (!program) return false

  try {
    return new FreeReferenceScan(program).found
  } catch {
    return false
  }
}
