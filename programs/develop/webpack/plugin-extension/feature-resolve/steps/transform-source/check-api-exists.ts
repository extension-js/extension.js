import {Expression, Super} from 'acorn'

function isMethodChain(callee: Expression | Super, chain: string[]): boolean {
  let current = callee
  for (let i = chain.length - 1; i >= 0; i--) {
    if (i === 0) {
      // The last element should be an Identifier at the top of the chain
      return current.type === 'Identifier' && current.name === chain[i]
    } else {
      // Intermediate elements should be MemberExpressions
      if (
        current.type !== 'MemberExpression' ||
        current.property.type !== 'Identifier' ||
        current.property.name !== chain[i]
      ) {
        return false
      }
      current = current.object
    }
  }
  return true
}

export function has(callee: Expression | Super, method: string): boolean {
  const methodArr = method.split('.')

  return isMethodChain(callee, methodArr)
}
