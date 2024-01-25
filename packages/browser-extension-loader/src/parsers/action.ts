export function isChromeAction(callee: any) {
  return (
    callee.object.property.type === 'Identifier' &&
    callee.object.property.name === 'runtime'
  )
}

export function isChromeActionSetIcon(callee: any) {
  return (
    callee.property.type === 'Identifier' && callee.property.name === 'setIcon'
  )
}
export function isChromeActionSetPopup(callee: any) {
  return (
    callee.property.type === 'Identifier' && callee.property.name === 'setPopup'
  )
}

export function isChromeActionSetBadgeText(callee: any) {
  return (
    callee.property.type === 'Identifier' &&
    callee.property.name === 'setBadgeText'
  )
}
