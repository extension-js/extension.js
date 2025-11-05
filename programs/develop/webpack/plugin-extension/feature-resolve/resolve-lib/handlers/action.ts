import {getPropName, memberChainFromCallee, resolveLiteralToOutput} from '..'
import {isStringLiteral, isStaticTemplate, evalStaticString} from '../ast'
import type {RewriteFn} from './types'

export function handleActionAndPopup(
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
    method.endsWith('action.setIcon') ||
    method.endsWith('pageAction.setIcon') ||
    method.endsWith('browserAction.setIcon')
  ) {
    const firstArgument = node.arguments?.[0]?.expression

    if (firstArgument?.type === 'ObjectExpression') {
      for (const propertyNode of firstArgument.properties || []) {
        if (propertyNode.type !== 'KeyValueProperty') continue

        const keyName = getPropName(propertyNode)

        if (keyName !== 'path') continue

        const valueNode = propertyNode.value

        if (isStringLiteral(valueNode)) {
          const resolved = resolveLiteralToOutput(valueNode.value, {
            manifestPath
          })

          rewriteValue(valueNode, resolved, valueNode.value)
        } else if (valueNode?.type === 'ObjectExpression') {
          for (const innerProperty of valueNode.properties || []) {
            if (
              innerProperty.type === 'KeyValueProperty' &&
              isStringLiteral(innerProperty.value)
            ) {
              const resolved = resolveLiteralToOutput(
                innerProperty.value.value,
                {
                  manifestPath
                }
              )

              rewriteValue(
                innerProperty.value,
                resolved,
                innerProperty.value.value
              )
            } else if (
              innerProperty.type === 'KeyValueProperty' &&
              isStaticTemplate(innerProperty.value)
            ) {
              const raw = source.slice(
                innerProperty.value.span.start + 1,
                innerProperty.value.span.end - 1
              )
              const resolved = resolveLiteralToOutput(raw, {
                manifestPath
              })

              rewriteValue(innerProperty.value, resolved, raw)
            } else if (innerProperty.type === 'KeyValueProperty') {
              const raw = evalStaticString(innerProperty.value)

              if (typeof raw === 'string') {
                const resolved = resolveLiteralToOutput(raw, {
                  manifestPath
                })
                const originalExpr = source.slice(
                  innerProperty.value.span.start,
                  innerProperty.value.span.end
                )

                rewriteValue(innerProperty.value as any, resolved, originalExpr)
              }
            }
          }
        } else if (isStaticTemplate(valueNode)) {
          const raw = source.slice(
            valueNode.span.start + 1,
            valueNode.span.end - 1
          )
          const resolved = resolveLiteralToOutput(raw, {
            manifestPath
          })

          rewriteValue(valueNode, resolved, raw)
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
          }
        }
      }
    }
    return true
  }

  if (
    method.endsWith('action.setPopup') ||
    method.endsWith('pageAction.setPopup') ||
    method.endsWith('browserAction.setPopup')
  ) {
    const firstArgument = node.arguments?.[0]?.expression

    if (firstArgument?.type === 'ObjectExpression') {
      for (const propertyNode of firstArgument.properties || []) {
        if (propertyNode.type !== 'KeyValueProperty') continue

        const keyName = getPropName(propertyNode)

        if (keyName !== 'popup') continue

        const valueNode = propertyNode.value

        if (isStringLiteral(valueNode)) {
          const resolved = resolveLiteralToOutput(valueNode.value, {
            manifestPath
          })

          rewriteValue(valueNode, resolved)
        } else if (isStaticTemplate(valueNode)) {
          const raw = source.slice(
            valueNode.span.start + 1,
            valueNode.span.end - 1
          )
          const resolved = resolveLiteralToOutput(raw, {
            manifestPath
          })

          rewriteValue(valueNode, resolved)
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
          }
        }
      }
    }

    return true
  }

  return false
}
