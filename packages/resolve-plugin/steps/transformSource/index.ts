import traverse from '@babel/traverse'
import generate from '@babel/generator'

import {has} from './checkApiExists'
import {resolvePropertyArg, resolveStringArg} from './parser'

export default function transformSource(ast: any, source: string) {
  traverse(ast as any, {
    CallExpression(path: any) {
      const callee = path.node.callee
      const args = path.node.arguments

      if (
        has(callee, 'chrome.action.setIcon') ||
        has(callee, 'chrome.browserAction.setIcon') ||
        has(callee, 'chrome.pageAction.setIcon') ||
        has(callee, 'chrome.declarativeContent.SetIcon') ||
        has(callee, 'chrome.action.setPopup') ||
        has(callee, 'chrome.browserAction.setPopup') ||
        has(callee, 'chrome.pageAction.setPopup') ||
        has(callee, 'chrome.scriptBadge.setPopup')
      ) {
        resolvePropertyArg(path, 'r.solve')
      }

      if (has(callee, 'chrome.devtools.panels.create')) {
        resolveStringArg(path, 'chrome.devtools.panels.create')
      }

      if (has(callee, 'chrome.downloads.download')) {
        resolvePropertyArg(path, 'r.solve')
      }

      if (has(callee, 'chrome.runtime.getURL')) {
        resolveStringArg(path, 'chrome.runtime.getURL')
      }

      if (
        has(callee, 'chrome.scripting.insertCSS') ||
        has(callee, 'chrome.scripting.removeCSS') ||
        has(callee, 'chrome.scripting.executeScript')
      ) {
        resolvePropertyArg(path, 'r.solve')
      }

      if (
        has(callee, 'chrome.scripting.registerContentScripts') ||
        has(callee, 'chrome.declarativeContent.RequestContentScript')
      ) {
        resolvePropertyArg(path, 'r.solve')
      }

      if (has(callee, 'chrome.declarativeContent.RequestContentScript')) {
        resolvePropertyArg(path, 'r.solve')
      }

      if (
        has(callee, 'chrome.tabs.create') ||
        has(callee, 'chrome.tabs.executeScript') ||
        has(callee, 'chrome.tabs.insertCSS') ||
        has(callee, 'chrome.windows.create')
      ) {
        if (args.length > 0) {
          resolvePropertyArg(path, 'r.solve')
        }
      }

      if (has(callee, 'chrome.sidePanel.setOptions')) {
        resolvePropertyArg(path, 'r.solve')
      }

      if (has(callee, 'chrome.notifications.create')) {
        resolvePropertyArg(path, 'r.solve')
      }
    }
  })

  const output = generate(
    ast as any,
    {
      decoratorsBeforeExport: false
    },
    source
  )

  return output.code
}
