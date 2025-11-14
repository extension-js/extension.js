import {getPropName, memberChainFromCallee, resolveLiteralToOutput} from '..'
import {evalStaticString, isStaticTemplate, isStringLiteral} from '../ast'
import type {RewriteFn} from './types'

const ALLOWED_KEYS = new Set([
  'url',
  'file',
  'files',
  'path',
  'popup',
  'panel',
  'page',
  'iconUrl',
  'imageUrl',
  'default_icon',
  'default_popup',
  'default_panel'
])

function processValue(
  valueNode: any,
  source: string,
  rewriteValue: RewriteFn,
  manifestPath: string
) {
  if (!valueNode) return

  if (isStringLiteral(valueNode)) {
    const out = resolveLiteralToOutput(valueNode.value, {
      manifestPath
    })

    rewriteValue(valueNode, out, valueNode.value)
    return
  }

  if (isStaticTemplate(valueNode)) {
    const raw = source.slice(valueNode.span.start + 1, valueNode.span.end - 1)
    const out = resolveLiteralToOutput(raw, {
      manifestPath
    })

    rewriteValue(valueNode, out, raw)
    return
  }

  const raw = evalStaticString(valueNode)

  if (typeof raw === 'string') {
    const out = resolveLiteralToOutput(raw, {
      manifestPath
    })

    const originalExpr = source.slice(valueNode.span.start, valueNode.span.end)
    rewriteValue(valueNode as any, out, originalExpr)

    return
  }
}

function walkCandidate(containerNode: any, onCandidateValue: (v: any) => void) {
  if (!containerNode) return

  if (containerNode.type === 'ArrayExpression') {
    for (const elementNode of containerNode.elements || [])
      onCandidateValue(elementNode?.expression)
    return
  }

  if (containerNode.type === 'ObjectExpression') {
    for (const propertyNode of containerNode.properties || []) {
      if (propertyNode.type !== 'KeyValueProperty') {
        continue
      }

      const key = getPropName(propertyNode)

      if (!key) {
        continue
      }

      if (ALLOWED_KEYS.has(key)) onCandidateValue(propertyNode.value)

      // Recurse into nested structures
      if (
        propertyNode.value?.type === 'ArrayExpression' ||
        propertyNode.value?.type === 'ObjectExpression'
      ) {
        // Special case: nested size maps for icon paths, e.g., default_icon or path objects
        if (
          (key === 'default_icon' || key === 'path') &&
          propertyNode.value?.type === 'ObjectExpression'
        ) {
          for (const sizeProp of propertyNode.value.properties || []) {
            if (sizeProp.type !== 'KeyValueProperty') continue
            onCandidateValue(sizeProp.value)
          }
        } else {
          walkCandidate(propertyNode.value, onCandidateValue)
        }
      }
    }
  }
}

export function handleGenericApiPaths(
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

  // Inspect object/array arguments only; avoid positional generic rewrites
  let touched = false

  for (const argumentNode of node.arguments || []) {
    const expressionNode = argumentNode?.expression
    if (!expressionNode) continue

    if (
      expressionNode.type === 'ObjectExpression' ||
      expressionNode.type === 'ArrayExpression'
    ) {
      walkCandidate(expressionNode, (candidateValue) => {
        const touchedBefore = touched
        processValue(candidateValue, source, rewriteValue, manifestPath)

        if (!touchedBefore) touched = true
      })
    }
  }

  return touched
}

export function handleGenericExpressions(
  node: any,
  source: string,
  rewriteValue: RewriteFn,
  manifestPath: string
): boolean {
  if (!node) return false

  if (node.type !== 'ObjectExpression' && node.type !== 'ArrayExpression') {
    return false
  }

  let touched = false

  walkCandidate(node, (candidateValue) => {
    const before = touched
    processValue(candidateValue, source, rewriteValue, manifestPath)

    if (!before) touched = true
  })

  return touched
}
