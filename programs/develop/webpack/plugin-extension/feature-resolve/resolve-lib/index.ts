import * as path from 'path'
import {unixify, getFilename} from '../../../webpack-lib/paths'

export function memberChainFromCallee(callee: any): string[] {
  const memberParts: string[] = []
  let currentExpression = callee

  while (currentExpression && currentExpression.type === 'ParenExpression')
    currentExpression = currentExpression.expression

  while (currentExpression) {
    if (currentExpression.type === 'Identifier') {
      memberParts.unshift(currentExpression.value)
      break
    }

    if (currentExpression.type === 'MemberExpression') {
      const propertyNode = currentExpression.property
      if (propertyNode?.type === 'Identifier')
        memberParts.unshift(propertyNode.value)

      currentExpression = currentExpression.object
      continue
    }

    break
  }

  return memberParts
}

export function getPropName(propertyNode: any): string | undefined {
  if (!propertyNode || propertyNode.type !== 'KeyValueProperty') {
    return undefined
  }

  const keyNode = propertyNode.key

  if (keyNode?.type === 'Identifier') {
    return keyNode.value
  }

  if (keyNode?.type === 'StringLiteral') {
    return keyNode.value
  }

  return undefined
}

export function isHttpLike(input: string) {
  return (
    /^https?:\/\//i.test(input) ||
    /^data:/i.test(input) ||
    /^chrome:\/\//i.test(input) ||
    /^moz-extension:\/\//i.test(input)
  )
}

export function hasGlob(input: string) {
  return /[*?\[\]{}]/.test(input)
}

export function resolveLiteralToOutput(
  literal: string,
  opts: {
    manifestPath: string
    packageJsonDir?: string
  }
): string | undefined {
  const {manifestPath, packageJsonDir} = opts
  const root = packageJsonDir || path.dirname(manifestPath)
  const canonicalUnixPath = unixify(literal || '')

  if (!literal || isHttpLike(literal) || hasGlob(literal)) {
    return undefined
  }

  if (/^\/public\//i.test(canonicalUnixPath)) {
    const out = canonicalUnixPath.replace(/^\/public\//i, '')
    return out
  }

  if (/^(?:\.\/)?public\//i.test(canonicalUnixPath)) {
    const out = canonicalUnixPath.replace(/^(?:\.\/)?public\//i, '')
    return out
  }

  if (/^\//.test(canonicalUnixPath)) {
    const out = canonicalUnixPath.replace(/^\//, '')
    return out
  }

  const candidateAbsolutePath = path.isAbsolute(literal)
    ? literal
    : path.join(root, literal)

  // Treat ./pages and ./scripts the same as pages and scripts
  const pathWithoutDotPrefix = canonicalUnixPath.replace(/^\.\//, '')

  if (/^pages\//i.test(pathWithoutDotPrefix)) {
    return unixify(getFilename(pathWithoutDotPrefix, candidateAbsolutePath))
  }

  if (/^scripts\//i.test(pathWithoutDotPrefix)) {
    return unixify(getFilename(pathWithoutDotPrefix, candidateAbsolutePath))
  }

  return undefined
}

export function visit(
  node: any,
  fn: (n: any, parent: any) => void,
  parent?: any
) {
  fn(node, parent)

  for (const key in node) {
    if (!Object.prototype.hasOwnProperty.call(node, key)) continue

    const child = (node as any)[key]

    if (!child) continue

    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && typeof c.type === 'string') visit(c, fn, node)
      }
    } else if (child && typeof child.type === 'string') {
      visit(child, fn, node)
    }
  }
}

export function buildStrictWarning(publicAbs: string) {
  return [
    'Check the path used in your extension API call.',
    "Paths starting with '/' are resolved from the extension output root (served from public/), not your source directory.",
    '',
    `NOT FOUND ${publicAbs}`
  ].join('\n')
}
