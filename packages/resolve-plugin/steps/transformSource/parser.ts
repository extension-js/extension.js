import * as t from '@babel/types'

export function resolvePropertyArg(path: any, resolverFunctionName: string) {
  if (path.node.arguments.length === 0) return

  const arg = path.node.arguments[0]
  path.node.arguments[0] = t.callExpression(
    t.identifier(resolverFunctionName),
    [arg]
  )
}

export function resolveStringArg(path: any, api: string) {
  if (path.node.arguments.length === 0) return

  if (api === 'chrome.devtools.panels.create') {
    path.node.arguments[1] = t.callExpression(t.identifier('r.solve'), [
      path.node.arguments[1]
    ])
    path.node.arguments[2] = t.callExpression(t.identifier('r.solve'), [
      path.node.arguments[2]
    ])
  } else if (api === 'chrome.runtime.getURL') {
    if (
      path.node.arguments[0].value &&
      path.node.arguments[0].value.includes('/_favicon/')
    ) {
      return
    }
    path.node.arguments[0] = t.callExpression(t.identifier('r.solve'), [
      path.node.arguments[0]
    ])
  }
}
