// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {
  type AstNode,
  children,
  list,
  node,
  parse
} from '../../../plugin-compatibility/compatibility-lib/free-browser-references'

// A build constant by its spelling: capitals, digits and underscores, the way
// define keys are written. A name with a lower case letter is never judged.
const CONSTANT_RE = /^_*[A-Z][A-Z0-9_]*$/
const TWO_CAPITALS_RE = /[A-Z][^A-Z]*[A-Z]/
const QUICK_RE = /(?<![\w$.])_*[A-Z][A-Z0-9_]*[A-Z][A-Z0-9_]*(?![\w$])/
const DYNAMIC_RE = /(?<![\w$])(?:importScripts|eval)(?![\w$])/

// The only globals a browser spells that way.
const PLATFORM_CONSTANTS = new Set([
  'CSS',
  'GPU',
  'HID',
  'JSON',
  'ML',
  'PERSISTENT',
  'TEMPORARY',
  'URL',
  'USB'
])

const LOGICAL_ASSIGNMENTS = new Set(['||=', '&&=', '??='])
const IMMEDIATE_METHODS = new Set(['call', 'apply'])

export function isConstantName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    CONSTANT_RE.test(name) &&
    TWO_CAPITALS_RE.test(name) &&
    !PLATFORM_CONSTANTS.has(name)
  )
}

export interface ConstantFacts {
  // Every constant the script spells as an identifier.
  seen: Set<string>
  // The ones the script declares, assigns, tests with typeof, or names as a
  // property or a string: its author provides them or expects them missing.
  provided: Set<string>
  // The script can take names from outside itself: importScripts, eval, with.
  dynamic: boolean
}

function emptyFacts(source: string): ConstantFacts {
  return {
    seen: new Set(),
    provided: new Set(),
    dynamic: DYNAMIC_RE.test(source)
  }
}

function bindingNames(pattern: unknown, into: Set<string>): void {
  const current = node(pattern)
  if (!current) return

  switch (current.type) {
    case 'Identifier':
      if (isConstantName(current.name)) into.add(current.name)

      return
    case 'ObjectPattern':
      for (const property of list(current.properties)) {
        bindingNames(
          property.type === 'RestElement' ? property.argument : property.value,
          into
        )
      }

      return
    case 'ArrayPattern':
      for (const element of list(current.elements)) bindingNames(element, into)

      return
    case 'AssignmentPattern':
      bindingNames(current.left, into)

      return
    case 'RestElement':
      bindingNames(current.argument, into)

      return
    default:
      return
  }
}

function collectFacts(program: AstNode, source: string): ConstantFacts {
  const facts = emptyFacts(source)

  const provide = (name: unknown) => {
    if (isConstantName(name)) facts.provided.add(name)
  }

  const stack = [program]

  while (stack.length) {
    const current = stack.pop() as AstNode

    switch (current.type) {
      case 'Identifier':
        if (isConstantName(current.name)) facts.seen.add(current.name)

        break
      case 'WithStatement':
        facts.dynamic = true

        break
      case 'VariableDeclarator':
      case 'ClassDeclaration':
      case 'ClassExpression':
        bindingNames(current.id, facts.provided)

        break
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        bindingNames(current.id, facts.provided)

        for (const param of list(current.params)) {
          bindingNames(param, facts.provided)
        }

        break
      case 'CatchClause':
        bindingNames(current.param, facts.provided)

        break
      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
        bindingNames(current.local, facts.provided)

        break
      case 'AssignmentExpression':
      case 'ForInStatement':
      case 'ForOfStatement':
        bindingNames(current.left, facts.provided)

        break
      case 'UpdateExpression':
        bindingNames(current.argument, facts.provided)

        break
      case 'UnaryExpression':
        if (current.operator === 'typeof') {
          bindingNames(current.argument, facts.provided)
        }

        break
      case 'MemberExpression':
        if (!current.computed) provide(node(current.property)?.name)

        break
      case 'Property':
      case 'MethodDefinition':
      case 'PropertyDefinition':
        if (!current.computed) provide(node(current.key)?.name)

        break
      case 'Literal':
        provide(current.value)

        break
      case 'TemplateElement':
        provide((current.value as {cooked?: unknown} | undefined)?.cooked)

        break
      default:
        break
    }

    stack.push(...children(current))
  }

  return facts
}

function isFunction(value: AstNode | undefined): boolean {
  return (
    value?.type === 'FunctionExpression' ||
    value?.type === 'ArrowFunctionExpression'
  )
}

// The function a call runs on the spot: `(() => {})()` or `(function () {}).call(this)`.
function invokedFunction(callee: AstNode | undefined): AstNode | undefined {
  let target = callee

  if (
    target?.type === 'MemberExpression' &&
    !target.computed &&
    IMMEDIATE_METHODS.has(String(node(target.property)?.name))
  ) {
    target = node(target.object)
  }

  return target && isFunction(target) && !target.generator ? target : undefined
}

function leavesEarly(statement: AstNode): boolean {
  const stack = [statement]

  while (stack.length) {
    const current = stack.pop() as AstNode

    if (
      current.type === 'ReturnStatement' ||
      current.type === 'ThrowStatement'
    ) {
      return true
    }

    if (
      (current.type === 'BreakStatement' ||
        current.type === 'ContinueStatement') &&
      current.label
    ) {
      return true
    }

    if (isFunction(current) || current.type === 'FunctionDeclaration') continue

    stack.push(...children(current))
  }

  return false
}

// Walks only what is certain to run as the script loads. A branch, a loop
// body, a try block and a function that is only defined are all left out.
class LoadTimeReads {
  public readonly names = new Set<string>()

  constructor(program: AstNode) {
    this.statements(list(program.body))
  }

  private statements(body: AstNode[]): boolean {
    for (const statement of body) {
      if (!this.statement(statement)) return false
    }

    return true
  }

  private statement(current: AstNode): boolean {
    switch (current.type) {
      case 'ExpressionStatement':
        this.expression(current.expression)

        return true
      case 'VariableDeclaration':
        for (const declarator of list(current.declarations)) {
          this.expression(declarator.init)
        }

        return true
      case 'ExportNamedDeclaration':

      case 'ExportDefaultDeclaration': {
        const declaration = node(current.declaration)

        if (declaration?.type === 'VariableDeclaration') {
          return this.statement(declaration)
        }

        this.expression(declaration)

        return true
      }

      case 'BlockStatement':
        return this.statements(list(current.body))
      case 'LabeledStatement':
        return this.statement(current.body as AstNode)
      case 'IfStatement':
      case 'WhileStatement':
        this.expression(current.test)

        return !leavesEarly(current)
      case 'SwitchStatement':
        this.expression(current.discriminant)

        return !leavesEarly(current)

      case 'ForStatement': {
        const init = node(current.init)

        if (init?.type === 'VariableDeclaration') this.statement(init)
        else this.expression(init)

        return !leavesEarly(current)
      }

      case 'ForInStatement':
      case 'ForOfStatement':
        this.expression(current.right)

        return !leavesEarly(current)
      case 'ReturnStatement':
      case 'ThrowStatement':
        this.expression(current.argument)

        return false
      case 'TryStatement':
      case 'DoWhileStatement':
        return !leavesEarly(current)
      default:
        return true
    }
  }

  private expressions(values: unknown): void {
    for (const value of list(values)) this.expression(value)
  }

  private call(current: AstNode): void {
    const callee = node(current.callee)
    const invoked = invokedFunction(callee)

    if (!invoked) this.expression(callee)

    this.expressions(current.arguments)

    if (!invoked) return

    const body = node(invoked.body)

    if (body?.type === 'BlockStatement') this.statements(list(body.body))
    else this.expression(body)
  }

  private expression(value: unknown): void {
    const current = node(value)
    if (!current) return

    switch (current.type) {
      case 'Identifier':
        if (isConstantName(current.name)) this.names.add(current.name)

        return
      case 'TemplateLiteral':
      case 'SequenceExpression':
        this.expressions(current.expressions)

        return
      case 'TaggedTemplateExpression':
        this.expression(current.tag)
        this.expression(current.quasi)

        return
      case 'ArrayExpression':
        this.expressions(current.elements)

        return
      case 'ObjectExpression':
        for (const property of list(current.properties)) {
          if (property.type === 'SpreadElement') {
            this.expression(property.argument)
            continue
          }

          if (property.computed) this.expression(property.key)

          this.expression(property.value)
        }

        return
      case 'SpreadElement':
      case 'AwaitExpression':
        this.expression(current.argument)

        return
      case 'UnaryExpression':
        if (current.operator !== 'typeof') this.expression(current.argument)

        return
      case 'BinaryExpression':
        this.expression(current.left)
        this.expression(current.right)

        return
      case 'LogicalExpression':
        this.expression(current.left)

        return
      case 'ConditionalExpression':
        this.expression(current.test)

        return
      case 'AssignmentExpression':
        if (node(current.left)?.type === 'MemberExpression') {
          this.expression(current.left)
        }

        if (!LOGICAL_ASSIGNMENTS.has(String(current.operator))) {
          this.expression(current.right)
        }

        return
      case 'MemberExpression':
        this.expression(current.object)
        if (current.computed) this.expression(current.property)

        return
      case 'CallExpression':
      case 'NewExpression':
        this.call(current)

        return
      case 'ImportExpression':
        this.expression(current.source)

        return
      default:
        return
    }
  }
}

// What a script says about its own constants, or nothing to say when it
// spells none or does not parse.
export function constantFacts(source: string): ConstantFacts {
  if (!QUICK_RE.test(source)) return emptyFacts(source)

  const program = parse(source)
  if (!program) return emptyFacts(source)

  try {
    return collectFacts(program, source)
  } catch {
    return emptyFacts(source)
  }
}

export interface LoadTimeConstants extends ConstantFacts {
  // The constants the script is certain to read while it loads.
  reads: Set<string>
}

export function loadTimeConstants(source: string): LoadTimeConstants {
  const nothing = {...emptyFacts(source), reads: new Set<string>()}
  if (!QUICK_RE.test(source)) return nothing

  const program = parse(source)
  if (!program) return nothing

  try {
    return {
      ...collectFacts(program, source),
      reads: new LoadTimeReads(program).names
    }
  } catch {
    return nothing
  }
}
