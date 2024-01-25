export function isBrowser(callee: any) {
  return (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'MemberExpression' &&
    callee.object.object.type === 'Identifier' &&
    callee.object.object.name === 'chrome'
  )
}

export function isNamespace(callee: any, namespace: string) {
  if (!isBrowser(callee)) false

  return (
    callee.object.property.type === 'Identifier' &&
    callee.object.property.name === namespace
  )
}

export function isMethod(callee: any, namespace: string, func: string) {
  if (!isNamespace(callee, namespace)) false

  return callee.property.type === 'Identifier' && callee.property.name === func
}

export function isListener(
  callee: any,
  namespace: string,
  func: string,
  listener: string
) {
  if (!isMethod(callee, namespace, func)) false

  return (
    callee.property.type === 'Identifier' && callee.property.name === listener
  )
}
