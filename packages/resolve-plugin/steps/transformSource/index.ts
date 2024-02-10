import traverse from '@babel/traverse'
import generate from '@babel/generator'
import template from '@babel/template'
import * as BabelTypes from '@babel/types'

import {has} from './checkApiExists'
import {resolvePropertyArg, resolveStringArg} from './parser'

function importOnce(ast: any, resolverRelativePath: string) {
  let importAdded = false

  // Check if the import statement already exists
  traverse(ast, {
    ImportDeclaration(path) {
      if (path.node.source.value === resolverRelativePath) {
        importAdded = true
        // Stop traversal once found
        path.stop()
      }
    }
  })

  // Add the import declaration only if it doesn't exist
  if (!importAdded) {
    const importDeclaration = template.ast(
      `import r from '${resolverRelativePath}';`,
      {preserveComments: true}
    )
    ast.program.body.push(importDeclaration)
  }
}

export default function transformSource(
  ast: any,
  source: string,
  resolverRelativePath: string
) {
  importOnce(ast, resolverRelativePath)

  if (!BabelTypes.isFile(ast) || !BabelTypes.isProgram(ast.program)) {
    throw new Error('Unable to parse source code into AST')
  }

  traverse(ast as any, {
    CallExpression(path: any) {
      const callee = path.node.callee
      const args = path.node.arguments

      if (
        has(callee, 'chrome.action.setIcon') ||
        has(callee, 'chrome.browserAction.setIcon') ||
        has(callee, 'chrome.pageAction.setIcon')
      ) {
        resolvePropertyArg(path, 'r.resolvePath')
      }

      if (
        has(callee, 'chrome.action.setPopup') ||
        has(callee, 'chrome.browserAction.setPopup') ||
        has(callee, 'chrome.pageAction.setPopup') ||
        has(callee, 'chrome.scriptBadge.setPopup')
      ) {
        resolvePropertyArg(path, 'r.resolvePopup')
      }

      if (has(callee, 'chrome.devtools.panels.create')) {
        resolveStringArg(path, 'chrome.devtools.panels.create')
      }

      if (has(callee, 'chrome.downloads.download')) {
        if (args.length > 0) {
          resolvePropertyArg(path, 'r.resolveUrl')
        }
      }

      if (has(callee, 'chrome.runtime.getURL')) {
        resolveStringArg(path, 'chrome.runtime.getURL')
      }

      if (
        has(callee, 'chrome.scripting.insertCSS') ||
        has(callee, 'chrome.scripting.removeCSS') ||
        has(callee, 'chrome.scripting.executeScript')
      ) {
        resolvePropertyArg(path, 'r.resolveFiles')
      }

      if (
        has(callee, 'chrome.scripting.registerContentScripts') ||
        has(callee, 'chrome.declarativeContent.RequestContentScript')
      ) {
        resolvePropertyArg(path, 'r.resolveJs')
      }

      if (has(callee, 'chrome.declarativeContent.RequestContentScript')) {
        resolvePropertyArg(path, 'r.resolveCss')
      }

      if (
        has(callee, 'chrome.tabs.create') ||
        has(callee, 'chrome.tabs.executeScript') ||
        has(callee, 'chrome.tabs.insertCSS') ||
        has(callee, 'chrome.windows.create')
      ) {
        if (args.length > 0) {
          resolvePropertyArg(path, 'r.resolveUrl')
        }
      }

      if (has(callee, 'chrome.sidePanel.setOptions')) {
        resolvePropertyArg(path, 'r.resolvePath')
      }

      if (has(callee, 'chrome.notifications.create')) {
        resolvePropertyArg(path, 'r.resolveIconUrl')
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
