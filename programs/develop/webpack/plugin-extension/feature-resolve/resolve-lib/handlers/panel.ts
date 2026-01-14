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

export function handlePanels(
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
    method.endsWith('sidePanel.setOptions') ||
    method.endsWith('sidebarAction.setPanel')
  ) {
    const firstArgument = node.arguments?.[0]?.expression

    // sidebarAction.setPanel(stringLiteral)
    if (method.endsWith('sidebarAction.setPanel')) {
      const arg = firstArgument
      if (isStringLiteral(arg)) {
        const resolved = resolveLiteralToOutput(arg.value, {
          manifestPath
        })
        rewriteValue(arg, resolved, arg.value)
        return true
      } else if (isStaticTemplate(arg)) {
        const raw = source.slice(arg.span.start + 1, arg.span.end - 1)
        const resolved = resolveLiteralToOutput(raw, {
          manifestPath
        })
        rewriteValue(arg, resolved, raw)
        return true
      } else {
        const raw = evalStaticString(arg)
        if (typeof raw === 'string') {
          const resolved = resolveLiteralToOutput(raw, {
            manifestPath
          })
          const originalExpr = source.slice(arg.span.start, arg.span.end)
          rewriteValue(arg as any, resolved, originalExpr)
          return true
        }
      }
    }

    // sidePanel.setOptions({ page/panel/path: ... })
    if (firstArgument?.type === 'ObjectExpression') {
      for (const propertyNode of firstArgument.properties || []) {
        if (propertyNode.type !== 'KeyValueProperty') continue

        const keyName = getPropName(propertyNode)

        if (keyName === 'path' || keyName === 'panel' || keyName === 'page') {
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
    }

    return true
  }

  return false
}
