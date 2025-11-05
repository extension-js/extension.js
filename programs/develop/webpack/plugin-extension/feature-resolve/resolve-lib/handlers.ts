import type {RewriteFn} from './handlers/types'
import {handleRuntimeCalls} from './handlers/runtime'
import {handleActionAndPopup} from './handlers/action'
import {handleDevtools} from './handlers/devtools'
import {handleTabsAndWindows} from './handlers/tabs'
import {handleScripting} from './handlers/scripting'
import {handleMv2Tabs} from './handlers/mv2'
import {handlePanels} from './handlers/panel'
import {handleNotifications} from './handlers/notifications'
import {handleMenus} from './handlers/menus'
import {handleDeclarativeContent} from './handlers/declarative-content'
import {handleGenericApiPaths} from './handlers/generic'

export type {RewriteFn}

export function handleCallExpression(
  node: any,
  source: string,
  rewriteValue: RewriteFn,
  manifestPath: string
): void {
  if (handleRuntimeCalls(node, source, rewriteValue, manifestPath)) {
    // console.debug('[resolve-paths] handled by runtime')
    return
  }

  if (handleActionAndPopup(node, source, rewriteValue, manifestPath)) {
    // console.debug('[resolve-paths] handled by action/popup')
    return
  }

  if (handleDevtools(node, source, rewriteValue, manifestPath)) {
    // console.debug('[resolve-paths] handled by devtools')
    return
  }

  if (handleTabsAndWindows(node, source, rewriteValue, manifestPath)) {
    // console.debug('[resolve-paths] handled by tabs/windows')
    return
  }

  if (handleScripting(node, source, rewriteValue, manifestPath)) {
    // console.debug('[resolve-paths] handled by scripting')
    return
  }

  if (handleMv2Tabs(node, source, rewriteValue, manifestPath)) {
    // console.debug('[resolve-paths] handled by mv2 tabs')
    return
  }

  if (handlePanels(node, source, rewriteValue, manifestPath)) {
    // console.debug('[resolve-paths] handled by panels')
    return
  }

  if (handleNotifications(node, source, rewriteValue, manifestPath)) {
    // console.debug('[resolve-paths] handled by notifications')
    return
  }

  if (handleMenus(node, source, rewriteValue, manifestPath)) {
    // console.debug('[resolve-paths] handled by menus')
    return
  }

  if (handleDeclarativeContent(node, source, rewriteValue, manifestPath)) {
    // console.debug('[resolve-paths] handled by declarative content')
    return
  }

  // Generic walker last: handles arrays / nested objects not covered above.
  try {
    handleGenericApiPaths(node, source, rewriteValue, manifestPath)
  } catch {
    // console.debug('[resolve-paths] failed to handle generic api paths')
  }
}
