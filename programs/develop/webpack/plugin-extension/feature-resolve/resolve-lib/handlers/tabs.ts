// ██████╗ ███████╗███████╗ ██████╗ ██╗    ██╗   ██╗███████╗
// ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║    ██║   ██║██╔════╝
// ██████╔╝█████╗  ███████╗██║   ██║██║    ██║   ██║█████╗
// ██╔══██╗██╔══╝  ╚════██║██║   ██║██║    ╚██╗ ██╔╝██╔══╝
// ██║  ██║███████╗███████║╚██████╔╝███████╗╚████╔╝ ███████╗
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚══════╝ ╚═══╝  ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {getPropName, memberChainFromCallee, resolveLiteralToOutput} from '..'
import {isStringLiteral, isStaticTemplate, evalStaticString} from '../ast'
import type {RewriteFn} from './types'

export function handleTabsAndWindows(
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

  if (method.endsWith('tabs.create') || method.endsWith('windows.create')) {
    const firstArgument = node.arguments?.[0]?.expression

    if (firstArgument?.type === 'ObjectExpression') {
      for (const propertyNode of firstArgument.properties || []) {
        if (propertyNode.type !== 'KeyValueProperty') continue

        const keyName = getPropName(propertyNode)

        if (keyName !== 'url') continue

        const valueNode = propertyNode.value

        if (isStringLiteral(valueNode)) {
          const resolved = resolveLiteralToOutput(valueNode.value, {
            manifestPath
          })

          rewriteValue(valueNode, resolved, valueNode.value)
        } else if (valueNode?.type === 'ArrayExpression') {
          for (const arrayElement of valueNode.elements || []) {
            const literalNode = arrayElement?.expression

            if (isStringLiteral(literalNode)) {
              const resolved = resolveLiteralToOutput(literalNode.value, {
                manifestPath
              })

              rewriteValue(literalNode, resolved, literalNode.value)
            } else if (isStaticTemplate(literalNode)) {
              const raw = source.slice(
                literalNode.span.start + 1,
                literalNode.span.end - 1
              )
              const resolved = resolveLiteralToOutput(raw, {
                manifestPath
              })

              rewriteValue(literalNode, resolved, raw)
            } else {
              const raw = evalStaticString(literalNode)

              if (typeof raw === 'string') {
                const resolved = resolveLiteralToOutput(raw, {
                  manifestPath
                })
                const originalExpr = source.slice(
                  literalNode.span.start,
                  literalNode.span.end
                )

                rewriteValue(literalNode as any, resolved, originalExpr)
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

  if (method.endsWith('tabs.update')) {
    const optionsArgument =
      node.arguments?.[1]?.expression || node.arguments?.[0]?.expression

    if (optionsArgument?.type === 'ObjectExpression') {
      for (const propertyNode of optionsArgument.properties || []) {
        if (propertyNode.type !== 'KeyValueProperty') continue

        const keyName = getPropName(propertyNode)

        if (keyName !== 'url') continue

        const valueNode = propertyNode.value

        if (isStringLiteral(valueNode)) {
          const resolved = resolveLiteralToOutput(valueNode.value, {
            manifestPath
          })

          rewriteValue(valueNode, resolved, valueNode.value)
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
