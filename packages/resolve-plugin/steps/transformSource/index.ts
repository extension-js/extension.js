import traverse from '@babel/traverse'
import generate from '@babel/generator'

import {has} from './checkApiExists'
import {resolvePropertyArg, resolveStringArg} from './parser'

function checkMethod(callee: any, args: any, path: any, namespace: string) {
  if (
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    has(callee, `${namespace}.action.setIcon`) ||
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    has(callee, `${namespace}.browserAction.setIcon`) ||
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    has(callee, `${namespace}.pageAction.setIcon`) ||
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    has(callee, `${namespace}.declarativeContent.SetIcon`) ||
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    has(callee, `${namespace}.action.setPopup`) ||
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    has(callee, `${namespace}.browserAction.setPopup`) ||
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    has(callee, `${namespace}.pageAction.setPopup`) ||
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    has(callee, `${namespace}.scriptBadge.setPopup`)
  ) {
    resolvePropertyArg(path, 'r.solve')
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  if (has(callee, `${namespace}.devtools.panels.create`)) {
    resolveStringArg(path, `${namespace}.devtools.panels.create`)
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  if (has(callee, `${namespace}.downloads.download`)) {
    resolvePropertyArg(path, 'r.solve')
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  if (has(callee, `${namespace}.runtime.getURL`)) {
    resolveStringArg(path, `${namespace}.runtime.getURL`)
  }

  if (
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    has(callee, `${namespace}.scripting.insertCSS`) ||
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    has(callee, `${namespace}.scripting.removeCSS`) ||
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    has(callee, `${namespace}.scripting.executeScript`)
  ) {
    resolvePropertyArg(path, 'r.solve')
  }

  if (
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    has(callee, `${namespace}.scripting.registerContentScripts`) ||
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    has(callee, `${namespace}.declarativeContent.RequestContentScript`)
  ) {
    resolvePropertyArg(path, 'r.solve')
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  if (has(callee, `${namespace}.declarativeContent.RequestContentScript`)) {
    resolvePropertyArg(path, 'r.solve')
  }

  if (
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    has(callee, `${namespace}.tabs.create`) ||
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    has(callee, `${namespace}.tabs.executeScript`) ||
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    has(callee, `${namespace}.tabs.insertCSS`) ||
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    has(callee, `${namespace}.windows.create`)
  ) {
    if (args.length > 0) {
      resolvePropertyArg(path, 'r.solve')
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  if (has(callee, `${namespace}.sidePanel.setOptions`)) {
    resolvePropertyArg(path, 'r.solve')
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  if (has(callee, `${namespace}.notifications.create`)) {
    resolvePropertyArg(path, 'r.solve')
  }
}

export default function transformSource(ast: any, source: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  traverse(ast, {
    CallExpression(path: any) {
      const namespaces = ['chrome', 'browser']
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const callee: any = path.node.callee
      const args = path.node.arguments

      namespaces.forEach((namespace) => {
        checkMethod(callee, args, path, namespace)
      })
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
