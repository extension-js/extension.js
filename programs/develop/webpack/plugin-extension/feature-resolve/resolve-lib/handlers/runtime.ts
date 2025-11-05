import {memberChainFromCallee, resolveLiteralToOutput} from '..'
import {isStringLiteral, isStaticTemplate, evalStaticString} from '../ast'
import type {RewriteFn} from './types'

export function handleRuntimeCalls(
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
    (method.endsWith('runtime.getURL') ||
      method.endsWith('extension.getURL')) &&
    node.arguments?.[0]
  ) {
    const firstArgument = node.arguments[0].expression

    if (isStringLiteral(firstArgument)) {
      const resolved = resolveLiteralToOutput(firstArgument.value, {
        manifestPath
      })

      rewriteValue(firstArgument, resolved, firstArgument.value)
    } else if (isStaticTemplate(firstArgument)) {
      const rawTemplate = source.slice(
        firstArgument.span.start + 1,
        firstArgument.span.end - 1
      )
      const resolved = resolveLiteralToOutput(rawTemplate, {
        manifestPath
      })

      rewriteValue(firstArgument, resolved, rawTemplate)
    } else {
      const staticallyEvaluated = evalStaticString(firstArgument)

      if (typeof staticallyEvaluated === 'string') {
        const resolved = resolveLiteralToOutput(staticallyEvaluated, {
          manifestPath
        })

        const originalExpr = source.slice(
          firstArgument.span.start,
          firstArgument.span.end
        )
        // Overwrite the whole expression span with a string literal
        rewriteValue(firstArgument as any, resolved, originalExpr)
      }
    }
    return true
  }

  return false
}
