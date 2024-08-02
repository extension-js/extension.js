import {transformSync} from '@swc/core'
import {parse, Expression, Super} from 'acorn'
import * as walk from 'acorn-walk'
import {generate} from 'astring'
import {has} from './check-api-exists'
import {resolvePropertyArg, resolveStringArg} from './parser'
import {LoaderOptions} from '../../index'

function checkMethod(
  callee: Expression | Super,
  args: any,
  path: any,
  namespace: string
) {
  if (
    has(callee, `${namespace}.action.setIcon`) ||
    has(callee, `${namespace}.browserAction.setIcon`) ||
    has(callee, `${namespace}.pageAction.setIcon`) ||
    has(callee, `${namespace}.declarativeContent.SetIcon`) ||
    has(callee, `${namespace}.action.setPopup`) ||
    has(callee, `${namespace}.browserAction.setPopup`) ||
    has(callee, `${namespace}.pageAction.setPopup`) ||
    has(callee, `${namespace}.scriptBadge.setPopup`)
  ) {
    resolvePropertyArg(path, 'r.solve')
  }

  if (has(callee, `${namespace}.devtools.panels.create`)) {
    resolveStringArg(path, `${namespace}.devtools.panels.create`)
  }

  if (has(callee, `${namespace}.downloads.download`)) {
    resolvePropertyArg(path, 'r.solve')
  }

  if (has(callee, `${namespace}.runtime.getURL`)) {
    resolveStringArg(path, `${namespace}.runtime.getURL`)
  }

  if (
    has(callee, `${namespace}.scripting.insertCSS`) ||
    has(callee, `${namespace}.scripting.removeCSS`) ||
    has(callee, `${namespace}.scripting.executeScript`)
  ) {
    resolvePropertyArg(path, 'r.solve')
  }

  if (
    has(callee, `${namespace}.scripting.registerContentScripts`) ||
    has(callee, `${namespace}.declarativeContent.RequestContentScript`)
  ) {
    resolvePropertyArg(path, 'r.solve')
  }

  if (has(callee, `${namespace}.declarativeContent.RequestContentScript`)) {
    resolvePropertyArg(path, 'r.solve')
  }

  if (
    has(callee, `${namespace}.tabs.create`) ||
    has(callee, `${namespace}.tabs.executeScript`) ||
    has(callee, `${namespace}.tabs.insertCSS`) ||
    has(callee, `${namespace}.windows.create`)
  ) {
    if (args.length > 0) {
      resolvePropertyArg(path, 'r.solve')
    }
  }

  if (has(callee, `${namespace}.sidePanel.setOptions`)) {
    resolvePropertyArg(path, 'r.solve')
  }

  if (has(callee, `${namespace}.notifications.create`)) {
    resolvePropertyArg(path, 'r.solve')
  }
}

export function transformSource(source: string, options: LoaderOptions) {
  // Use swc to transform the source
  const swcResult = transformSync(source, {
    jsc: {
      parser: {
        syntax: options.typescript ? 'typescript' : 'ecmascript',
        tsx: options.jsx
      },
      target: 'es2016',
      transform: {
        react: {
          runtime: 'automatic',
          importSource: 'react'
        }
      }
    },
    module: {
      type: 'es6'
    },
  })

  // Parse the transformed source to an AST
  const ast = parse(swcResult.code, {
    sourceType: 'module',
    ecmaVersion: 'latest'
  })

  // Traverse and modify the AST
  walk.simple(ast, {
    CallExpression(node) {
      const namespaces = ['chrome', 'browser']
      const callee = node.callee
      const args = node.arguments

      namespaces.forEach((namespace) => {
        checkMethod(callee, args, node, namespace)
      })
    }
  })

  // Generate the modified code from the AST
  const output = generate(ast)

  return output
}
