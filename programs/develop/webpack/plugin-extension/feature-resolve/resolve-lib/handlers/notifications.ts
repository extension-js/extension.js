import {getPropName, memberChainFromCallee, resolveLiteralToOutput} from '..'
import {isStringLiteral, isStaticTemplate, evalStaticString} from '../ast'
import type {RewriteFn} from './types'

export function handleNotifications(
  node: any,
  source: string,
  rewriteValue: RewriteFn,
  manifestPath: string
): boolean {
  if (node.type !== 'CallExpression') {
    return false
  }

  const memberChain = memberChainFromCallee(node.callee)
  const apiRoot = memberChain[0]

  if (apiRoot !== 'chrome' && apiRoot !== 'browser') {
    return false
  }

  const method = memberChain.join('.')
  // console.log('[resolve-paths] method', method)

  if (
    method.endsWith('notifications.create') ||
    method.endsWith('notifications.update')
  ) {
    const optionsArgument =
      node.arguments?.[1]?.expression || node.arguments?.[0]?.expression

    if (optionsArgument?.type === 'ObjectExpression') {
      let touched = false

      for (const propertyNode of optionsArgument.properties || []) {
        if (propertyNode.type !== 'KeyValueProperty') continue

        const keyName = getPropName(propertyNode)

        if (keyName === 'iconUrl' || keyName === 'imageUrl') {
          const valueNode = propertyNode.value

          if (isStringLiteral(valueNode)) {
            const resolved = resolveLiteralToOutput(valueNode.value, {
              manifestPath
            })

            rewriteValue(valueNode, resolved, valueNode.value)
            touched = true
          } else if (isStaticTemplate(valueNode)) {
            const raw = source.slice(
              valueNode.span.start + 1,
              valueNode.span.end - 1
            )
            const resolved = resolveLiteralToOutput(raw, {
              manifestPath
            })

            rewriteValue(valueNode, resolved, raw)
            touched = true
          } else {
            const raw = evalStaticString(valueNode)
            if (typeof raw === 'string') {
              const resolved = resolveLiteralToOutput(raw, {
                manifestPath
              })
              const originalExpr = source.slice(
                valueNode.span.start,
                valueNode.span.end
              )

              rewriteValue(valueNode as any, resolved, originalExpr)
              touched = true
            }
          }
        }
      }

      if (touched) return true
    }

    return false
  }

  return false
}
