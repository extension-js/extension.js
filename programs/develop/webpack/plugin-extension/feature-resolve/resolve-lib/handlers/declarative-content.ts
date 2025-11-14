import {memberChainFromCallee, resolveLiteralToOutput} from '..'
import {isStringLiteral, isStaticTemplate, evalStaticString} from '../ast'
import type {RewriteFn} from './types'

export function handleDeclarativeContent(
  node: any,
  source: string,
  rewriteValue: RewriteFn,
  manifestPath: string
): boolean {
  if (node.type !== 'NewExpression') {
    return false
  }

  const memberChain = memberChainFromCallee(node.callee)
  const apiRoot = memberChain[0]

  if (apiRoot !== 'chrome' && apiRoot !== 'browser') {
    return false
  }

  const method = memberChain.join('.')
  // console.log('[resolve-paths] method', method)

  if (method.endsWith('declarativeContent.SetIcon')) {
    const arg0 = node.arguments?.[0]
    const optionsArgument = (arg0 && (arg0 as any).expression) || arg0

    if (optionsArgument?.type === 'ObjectExpression') {
      for (const propertyNode of optionsArgument.properties || []) {
        if (propertyNode.type !== 'KeyValueProperty') {
          continue
        }

        const keyNode = propertyNode.key
        const keyName =
          keyNode?.type === 'Identifier' ? keyNode.value : keyNode?.value

        if (keyName !== 'path') {
          continue
        }

        const valueNode = propertyNode.value
        if (isStringLiteral(valueNode)) {
          const resolved = resolveLiteralToOutput(valueNode.value, {
            manifestPath
          })

          rewriteValue(valueNode, resolved, valueNode.value)
        } else if (valueNode?.type === 'ObjectExpression') {
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

  return false
}
