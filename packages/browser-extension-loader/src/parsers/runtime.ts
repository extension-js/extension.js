export function isChromeRuntime(callee: any) {
  return (
    callee.object.property.type === 'Identifier' &&
    callee.object.property.name === 'runtime'
  )
}

export function isChromeRuntimeGetURL(callee: any) {
  return (
    callee.property.type === 'Identifier' && callee.property.name === 'getURL'
  )
}
