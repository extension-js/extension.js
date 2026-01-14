// ██████╗ ███████╗███████╗ ██████╗ ██╗    ██╗   ██╗███████╗
// ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║    ██║   ██║██╔════╝
// ██████╔╝█████╗  ███████╗██║   ██║██║    ██║   ██║█████╗
// ██╔══██╗██╔══╝  ╚════██║██║   ██║██║    ╚██╗ ██╔╝██╔══╝
// ██║  ██║███████╗███████║╚██████╔╝███████╗╚████╔╝ ███████╗
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚══════╝ ╚═══╝  ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {memberChainFromCallee, resolveLiteralToOutput} from '..'
import {isStringLiteral, isStaticTemplate, evalStaticString} from '../ast'
import type {RewriteFn} from './types'

export function handleDevtools(
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

  if (method.endsWith('devtools.panels.create')) {
    const iconArg = node.arguments?.[1]?.expression
    const pageArg = node.arguments?.[2]?.expression

    let touched = false
    if (isStringLiteral(iconArg)) {
      const resolved = resolveLiteralToOutput(iconArg.value, {
        manifestPath
      })

      rewriteValue(iconArg, resolved, iconArg.value)
      touched = true
    } else if (isStaticTemplate(iconArg)) {
      const rawTemplate = source.slice(
        iconArg.span.start + 1,
        iconArg.span.end - 1
      )
      const resolved = resolveLiteralToOutput(rawTemplate, {
        manifestPath
      })

      rewriteValue(iconArg, resolved, rawTemplate)
    } else {
      const staticallyEvaluated = evalStaticString(iconArg)

      if (typeof staticallyEvaluated === 'string') {
        const resolved = resolveLiteralToOutput(staticallyEvaluated, {
          manifestPath
        })
        const originalExpr = source.slice(iconArg.span.start, iconArg.span.end)

        rewriteValue(iconArg as any, resolved, originalExpr)
        touched = true
      }
    }

    if (isStringLiteral(pageArg)) {
      const resolved = resolveLiteralToOutput(pageArg.value, {
        manifestPath
      })

      rewriteValue(pageArg, resolved, pageArg.value)
      touched = true
    } else if (isStaticTemplate(pageArg)) {
      const rawTemplate = source.slice(
        pageArg.span.start + 1,
        pageArg.span.end - 1
      )
      const resolved = resolveLiteralToOutput(rawTemplate, {
        manifestPath
      })

      rewriteValue(pageArg, resolved, rawTemplate)
    } else {
      const staticallyEvaluated = evalStaticString(pageArg)

      if (typeof staticallyEvaluated === 'string') {
        const resolved = resolveLiteralToOutput(staticallyEvaluated, {
          manifestPath
        })
        const originalExpr = source.slice(pageArg.span.start, pageArg.span.end)
        rewriteValue(pageArg as any, resolved, originalExpr)
        touched = true
      }
    }
    return touched
  }

  return false
}
