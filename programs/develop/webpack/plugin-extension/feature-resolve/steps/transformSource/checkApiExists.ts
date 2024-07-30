export interface Callee {
  type: string
  object: {
    type: string
    object?: {
      type: string
      name: string
    }
    property?: {
      type: string
      name: string
    }
  }
  property?: {
    type: string
    name: string
  }
}

function isMethodChain(callee: Callee, chain: string[]): boolean {
  let current: any = callee
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

export function has(callee: Callee, method: string): boolean {
  const methodArr = method.split('.')

  return isMethodChain(callee, methodArr)
}
