// ██████╗ ███████╗███████╗ ██████╗ ██╗    ██╗   ██╗███████╗
// ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║    ██║   ██║██╔════╝
// ██████╔╝█████╗  ███████╗██║   ██║██║    ██║   ██║█████╗
// ██╔══██╗██╔══╝  ╚════██║██║   ██║██║    ╚██╗ ██╔╝██╔══╝
// ██║  ██║███████╗███████║╚██████╔╝███████╗╚████╔╝ ███████╗
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚══════╝ ╚═══╝  ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

export type SWCString = {
  type: 'StringLiteral'
  value: string
  span: {start: number; end: number}
}

export type SWCTemplate = {
  type: 'TemplateLiteral'
  expressions: any[]
  quasis: Array<{
    raw: string
    cooked?: string
    span: {start: number; end: number}
  }>
  span: {start: number; end: number}
}

export function isStringLiteral(node: any): node is SWCString {
  return node && node.type === 'StringLiteral' && typeof node.value === 'string'
}

export function isStaticTemplate(node: any): node is SWCTemplate {
  return (
    node &&
    node.type === 'TemplateLiteral' &&
    Array.isArray(node.expressions) &&
    node.expressions.length === 0
  )
}

export function evalStaticString(node: any): string | undefined {
  if (!node) return undefined

  // Unwrap parenthesized expressions
  if (node && node.type === 'ParenExpression') {
    return evalStaticString(node.expression)
  }

  if (isStringLiteral(node)) return node.value

  if (isStaticTemplate(node)) {
    return node.quasis?.map((quasi: any) => quasi.raw ?? '').join('')
  }

  if (node && node.type === 'BinaryExpression' && node.operator === '+') {
    const left = evalStaticString(node.left)
    const right = evalStaticString(node.right)

    if (typeof left === 'string' && typeof right === 'string') {
      return left + right
    }
  }

  return undefined
}
