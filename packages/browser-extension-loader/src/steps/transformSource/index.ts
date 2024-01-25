import traverse from '@babel/traverse'
import generate from '@babel/generator'
import path from 'path'

import {has} from './checkApiExists'
import {
  handeFilesProperty,
  handlePathProperty,
  handlePopupProperty,
  handleStringProperty,
  handleUrlProperty
} from './parser'
import addImportDeclaration from '../addImportDeclaration'

export default function transformSource(
  ast: any,
  source: string,
  resolverModulePath?: string,
  self?: any
): string {
  const outputPath = self?._compilation?.options.output.path || ''
  const resolverAbsolutePath = path.resolve(
    outputPath,
    resolverModulePath || ''
  )

  traverse(ast as any, {
    CallExpression(path: any) {
      const callee = path.node.callee
      const args = path.node.arguments

      // addImportDeclaration(ast, resolverAbsolutePath!)
      if (
        has(callee, 'chrome.action.setIcon') ||
        has(callee, 'chrome.browserAction.setIcon') ||
        has(callee, 'chrome.pageAction.setIcon')
      ) {
        handlePathProperty(path)
      }

      if (
        has(callee, 'chrome.action.setPopup') ||
        has(callee, 'chrome.browserAction.setPopup') ||
        has(callee, 'chrome.pageAction.setPopup') ||
        has(callee, 'chrome.scriptBadge.setPopup')
      ) {
        handlePopupProperty(path)
      }

      if (has(callee, 'chrome.devtools.panels.create')) {
        handleStringProperty(path)
      }

      if (has(callee, 'chrome.downloads.download')) {
        handleUrlProperty(path)
      }

      if (has(callee, 'chrome.runtime.getURL')) {
        handleStringProperty(path)
      }

      if (
        has(callee, 'chrome.scripting.insertCSS') ||
        has(callee, 'chrome.scripting.removeCSS') ||
        has(callee, 'chrome.scripting.executeScript') ||
        has(callee, 'chrome.scripting.registerContentScript') ||
        has(callee, 'chrome.scripting.unregisterContentScript')
      ) {
        handeFilesProperty(path)
      }

      if (
        has(callee, 'chrome.tabs.create') ||
        has(callee, 'chrome.tabs.executeScript') ||
        has(callee, 'chrome.tabs.insertCSS')
      ) {
        if (args.length > 0) {
          handleUrlProperty(path)
        }
      }

      if (has(callee, 'chrome.sidePanel.setOptions')) {
        handlePathProperty(path)
      }
    }
  })

  const output = generate(ast as any, {}, source)
  return output.code
}
