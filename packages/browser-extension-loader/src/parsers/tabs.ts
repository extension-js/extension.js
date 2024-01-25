export function isChromeTabs(callee: any) {
  return (
    callee.object.property.type === 'Identifier' &&
    callee.object.property.name === 'tabs'
  )
}

export function isChromeTabsCreate(callee: any) {
  return (
    callee.property.type === 'Identifier' && callee.property.name === 'create'
  )
}
