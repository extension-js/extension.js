import {memberChainFromCallee, resolveLiteralToOutput} from '..'
import {isStringLiteral, isStaticTemplate, evalStaticString} from '../ast'
import type {RewriteFn} from './types'

export function handleMenus(
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

  if (
    method.endsWith('contextMenus.create') ||
    method.endsWith('contextMenus.update') ||
    method.endsWith('menus.create') ||
    method.endsWith('menus.update')
  ) {
    const firstArgument = node.arguments?.[0]?.expression

    if (firstArgument?.type === 'ObjectExpression') {
      for (const propertyNode of firstArgument.properties || []) {
        if (propertyNode.type !== 'KeyValueProperty') {
          continue
        }

        const keyNode = propertyNode.key
        const keyName =
          keyNode?.type === 'Identifier' ? keyNode.value : keyNode?.value

        if (keyName !== 'icons') {
          continue
        }

        const valueNode = propertyNode.value

        if (valueNode?.type === 'ObjectExpression') {
          for (const innerProperty of valueNode.properties || []) {
            if (innerProperty.type !== 'KeyValueProperty') {
              continue
            }

            const innerValue = innerProperty.value

            if (isStringLiteral(innerValue)) {
              const resolved = resolveLiteralToOutput(innerValue.value, {
                manifestPath
              })

              rewriteValue(innerValue, resolved, innerValue.value)
            } else if (isStaticTemplate(innerValue)) {
              const raw = source.slice(
                innerValue.span.start + 1,
                innerValue.span.end - 1
              )
              const resolved = resolveLiteralToOutput(raw, {
                manifestPath
              })

              rewriteValue(innerValue, resolved, raw)
            } else {
              const raw = evalStaticString(innerValue)

              if (typeof raw === 'string') {
                const resolved = resolveLiteralToOutput(raw, {
                  manifestPath
                })
                const originalExpr = source.slice(
                  innerValue.span.start,
                  innerValue.span.end
                )

                rewriteValue(innerValue as any, resolved, originalExpr)
              }
            }
          }
        }
      }
    }
    return true
  }

  return false
}
