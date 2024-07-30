export function resolvePropertyArg(path: any, resolverFunctionName: string) {
  if (path.arguments.length === 0) return

  const arg = path.arguments[0]
  path.arguments[0] = {
    type: 'CallExpression',
    callee: {type: 'Identifier', name: resolverFunctionName},
    arguments: [arg]
  }
}

export function resolveStringArg(path: any, api: string) {
  if (path.arguments.length === 0) return

  if (
    api === 'chrome.devtools.panels.create' ||
    api === 'browser.devtools.panels.create'
  ) {
    path.arguments[1] = {
      type: 'CallExpression',
      callee: {type: 'Identifier', name: 'r.solve'},
      arguments: [path.arguments[1]]
    }
    path.arguments[2] = {
      type: 'CallExpression',
      callee: {type: 'Identifier', name: 'r.solve'},
      arguments: [path.arguments[2]]
    }
  } else if (
    api === 'chrome.runtime.getURL' ||
    api === 'browser.runtime.getURL'
  ) {
    if (
      path.arguments[0].type === 'Literal' &&
      path.arguments[0].value.includes('/_favicon/')
    ) {
      return
    }
    path.arguments[0] = {
      type: 'CallExpression',
      callee: {type: 'Identifier', name: 'r.solve'},
      arguments: [path.arguments[0]]
    }
  }
}
