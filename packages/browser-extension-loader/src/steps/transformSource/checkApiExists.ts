import {Callee} from '../../types'

function isBrowser(callee: Callee, browser: string): boolean {
  return (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'MemberExpression' &&
    callee.object.object?.type === 'Identifier' &&
    callee.object.object.name === browser
  )
}

function isNamespace(
  callee: Callee,
  browser: string,
  namespace: string
): boolean {
  if (!isBrowser(callee, browser)) return false

  return (
    callee.object.property?.type === 'Identifier' &&
    callee.object.property.name === namespace
  )
}

function isMethod(
  callee: Callee,
  browser: string,
  namespace: string,
  func: string
): boolean {
  if (!isNamespace(callee, browser, namespace)) return false

  return callee.property?.type === 'Identifier' && callee.property.name === func
}

function isMethodWithinMethod(
  callee: Callee,
  browser: string,
  namespace: string,
  func: string,
  methodWithin: string
): boolean {
  if (!isMethod(callee, browser, namespace, func)) return false

  return (
    callee.property?.type === 'Identifier' &&
    callee.property.name === methodWithin
  )
}

export function has(callee: Callee, method: string): boolean {
  const methodArr = method.split('.')

  switch (methodArr.length) {
    case 1:
      return isBrowser(callee, methodArr[0])
    case 2:
      return isNamespace(callee, methodArr[0], methodArr[1])
    case 3:
      return isMethod(callee, methodArr[0], methodArr[1], methodArr[2])
    case 4:
      return isMethodWithinMethod(
        callee,
        methodArr[0],
        methodArr[1],
        methodArr[2],
        methodArr[3]
      )
    default:
      return false
  }
}
