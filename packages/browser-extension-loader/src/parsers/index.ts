function isBrowser(callee: any, browser: string) {
  return (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'MemberExpression' &&
    callee.object.object.type === 'Identifier' &&
    callee.object.object.name === browser
  )
}

function isNamespace(callee: any, browser: string, namespace: string) {
  if (!isBrowser(callee, browser)) false

  return (
    callee.object.property.type === 'Identifier' &&
    callee.object.property.name === namespace
  )
}

function isMethod(
  callee: any,
  browser: string,
  namespace: string,
  func: string
) {
  if (!isNamespace(callee, browser, namespace)) false

  return callee.property.type === 'Identifier' && callee.property.name === func
}

function isMethodWithinMethod(
  callee: any,
  browser: string,
  namespace: string,
  func: string,
  methodWithin: string
) {
  if (!isMethod(callee, browser, namespace, func)) false

  return (
    callee.property.type === 'Identifier' &&
    callee.property.name === methodWithin
  )
}

export function has(
  callee: any,
  method: string,
) {
  const methodArr = method.split('.')

  switch (methodArr.length) {
    case 1: 
      return isBrowser(callee, methodArr[0])
    case 2:
      return isNamespace(callee, methodArr[0], methodArr[1])
    case 3:
      return isMethod(
        callee,
        methodArr[0],
        methodArr[1],
        methodArr[2]
      )
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