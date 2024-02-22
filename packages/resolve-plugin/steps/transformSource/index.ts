import traverse from '@babel/traverse'
import generate from '@babel/generator'

import {has} from './checkApiExists'
import {resolvePropertyArg, resolveStringArg} from './parser'

export default function transformSource(ast: any, source: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  traverse(ast, {
    CallExpression(path: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const callee: any = path.node.callee
      const args = path.node.arguments

      if (
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        has(callee, 'chrome.action.setIcon') ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        has(callee, 'chrome.browserAction.setIcon') ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        has(callee, 'chrome.pageAction.setIcon') ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        has(callee, 'chrome.declarativeContent.SetIcon') ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        has(callee, 'chrome.action.setPopup') ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        has(callee, 'chrome.browserAction.setPopup') ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        has(callee, 'chrome.pageAction.setPopup') ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        has(callee, 'chrome.scriptBadge.setPopup')
      ) {
        resolvePropertyArg(path, 'r.solve')
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      if (has(callee, 'chrome.devtools.panels.create')) {
        resolveStringArg(path, 'chrome.devtools.panels.create')
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      if (has(callee, 'chrome.downloads.download')) {
        resolvePropertyArg(path, 'r.solve')
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      if (has(callee, 'chrome.runtime.getURL')) {
        resolveStringArg(path, 'chrome.runtime.getURL')
      }

      if (
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        has(callee, 'chrome.scripting.insertCSS') ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        has(callee, 'chrome.scripting.removeCSS') ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        has(callee, 'chrome.scripting.executeScript')
      ) {
        resolvePropertyArg(path, 'r.solve')
      }

      if (
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        has(callee, 'chrome.scripting.registerContentScripts') ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        has(callee, 'chrome.declarativeContent.RequestContentScript')
      ) {
        resolvePropertyArg(path, 'r.solve')
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      if (has(callee, 'chrome.declarativeContent.RequestContentScript')) {
        resolvePropertyArg(path, 'r.solve')
      }

      if (
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        has(callee, 'chrome.tabs.create') ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        has(callee, 'chrome.tabs.executeScript') ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        has(callee, 'chrome.tabs.insertCSS') ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        has(callee, 'chrome.windows.create')
      ) {
        if (args.length > 0) {
          resolvePropertyArg(path, 'r.solve')
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      if (has(callee, 'chrome.sidePanel.setOptions')) {
        resolvePropertyArg(path, 'r.solve')
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      if (has(callee, 'chrome.notifications.create')) {
        resolvePropertyArg(path, 'r.solve')
      }
    }
  })

  const output = generate(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    ast,
    {
      decoratorsBeforeExport: false
    },
    source
  )

  return output.code
}
