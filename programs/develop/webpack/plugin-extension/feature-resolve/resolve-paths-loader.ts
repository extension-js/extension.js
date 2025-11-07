import * as path from 'path'
import * as fs from 'fs'
import type {Program} from '@swc/core'
import {unixify} from './resolve-lib/paths'
import {resolveLiteralToOutput} from './resolve-lib'
import {evalStaticString} from './resolve-lib/ast'

let swcRuntimeModule: any

async function loadSwc() {
  if (swcRuntimeModule) return swcRuntimeModule
  try {
    const mod: any = await import('@swc/core')
    const candidateModule =
      mod?.default && mod.default.parse ? mod.default : mod

    if (candidateModule?.parse && candidateModule?.print) {
      swcRuntimeModule = candidateModule
      return swcRuntimeModule
    }
  } catch {
    console.error('Failed to load @swc/core')
  }

  return null
}

export default async function resolvePathsLoader(this: any, source: string) {
  const callback = this.async()
  const options = this.getOptions?.() || {}
  const manifestPath: string = options.manifestPath as string
  const packageJsonDir: string | undefined = options.packageJsonDir as
    | string
    | undefined

  // const debug: boolean = Boolean(options.debug)
  // sourceMaps: 'auto' | true | false (defaults to 'auto')
  const sourceMapsOpt: 'auto' | boolean =
    typeof options.sourceMaps === 'boolean' || options.sourceMaps === 'auto'
      ? options.sourceMaps
      : 'auto'

  this.cacheable && this.cacheable()

  // Skip any file under public/
  try {
    const resourcePathUnix = unixify(String(this.resourcePath || ''))
    if (resourcePathUnix.split('/').includes('public')) {
      return callback(null, source)
    }
  } catch {
    console.error('Failed to parse resource path')
  }

  // Fast pre-scan to avoid parsing when there's nothing to do
  try {
    const sourceString = String(source)
    const containsEligiblePatterns =
      sourceString.includes('chrome.') ||
      sourceString.includes('browser.') ||
      sourceString.includes('getURL(') ||
      sourceString.includes('/public/') ||
      sourceString.includes('pages/') ||
      sourceString.includes('scripts/')
    if (!containsEligiblePatterns) return callback(null, source)
  } catch {
    console.error('Failed to check for eligible patterns')
  }

  const swcModule = await loadSwc()
  if (!swcModule) return callback(null, source)

  let programAst: Program

  try {
    const isTS = /\.[cm]?tsx?$/.test(this.resourcePath)
    const isJSX = /\.[cm]?[jt]sx$/.test(this.resourcePath)

    programAst = await swcModule.parse(source, {
      syntax: isTS ? 'typescript' : 'ecmascript',
      tsx: isTS && isJSX,
      jsx: !isTS && isJSX,
      target: 'es2022'
    })
  } catch {
    return callback(null, source)
  }

  const ALLOWED_KEYS = new Set([
    'url',
    'file',
    'files',
    'path',
    'js',
    'css',
    'icons',
    'popup',
    'panel',
    'page',
    'iconUrl',
    'imageUrl',
    'default_icon',
    'default_popup',
    'default_panel'
  ])

  const perFileResolveCache = new Map<string, string | undefined>()

  const maybeResolve = (rawLiteral: string | undefined) => {
    if (!rawLiteral) return undefined
    if (perFileResolveCache.has(rawLiteral))
      return perFileResolveCache.get(rawLiteral)
    const resolvedLiteral = resolveLiteralToOutput(rawLiteral, {
      manifestPath,
      packageJsonDir
    })
    perFileResolveCache.set(rawLiteral, resolvedLiteral)
    return resolvedLiteral
  }

  const emittedBodies = new Set<string>()

  const emitStandardWarning = (headerFilePath: string, bodyLines: string[]) => {
    const bodyMessage = bodyLines.join('\n')

    if (emittedBodies.has(bodyMessage)) return

    emittedBodies.add(bodyMessage)
    const warning = new Error(bodyMessage)
    // @ts-expect-error file is not std prop
    warning.file = headerFilePath
    this.emitWarning?.(warning)
  }

  const warnIfMissingPublic = (
    original: string | undefined,
    computed: string | undefined
  ) => {
    try {
      const canonical = unixify(original || '')
      const looksLikePublicRoot =
        /^\//.test(canonical) ||
        /^\/public\//i.test(canonical) ||
        /^(?:\.\/)?public\//i.test(canonical)

      if (looksLikePublicRoot && computed) {
        const root = packageJsonDir || path.dirname(manifestPath)
        const publicAbs = path.join(root, 'public', computed)
        if (!fs.existsSync(publicAbs)) {
          emitStandardWarning(String(this.resourcePath), [
            'Check the path used in your extension API call.',
            "Paths starting with '/' are resolved from the extension output root (served from public/), not your source directory.",
            '',
            `NOT FOUND ${publicAbs}`
          ])
        }
      }
    } catch {
      // best-effort only
    }
  }

  const createStringLiteral = (value: string, span?: any) => ({
    type: 'StringLiteral',
    value,
    span: span || {start: 0, end: 0}
  })

  const self = this
  const rewriteExpression = (
    exprNode: any,
    allowObjectValueDeep = false
  ): any | null => {
    if (!exprNode) return null

    if (exprNode.type === 'StringLiteral') {
      const resolved = maybeResolve(exprNode.value)
      if (resolved) {
        warnIfMissingPublic(exprNode.value, resolved)
        return createStringLiteral(resolved, exprNode.span)
      }

      try {
        const canonical = unixify(exprNode.value || '')
        if (/^src\/(pages|scripts)\//i.test(canonical)) {
          const root = packageJsonDir || path.dirname(manifestPath)
          const abs = path.join(root, canonical)
          emitStandardWarning(String(self.resourcePath), [
            'Check the path used in your extension API call.',
            '',
            `NOT FOUND ${abs}`
          ])
        }
      } catch {
        // best-effort only
      }

      return null
    }

    if (
      exprNode.type === 'TemplateLiteral' &&
      Array.isArray(exprNode.expressions) &&
      exprNode.expressions.length === 0
    ) {
      const raw = (exprNode.quasis || [])
        .map((quasi: any) => String(quasi.raw || ''))
        .join('')
      const resolved = maybeResolve(raw)

      if (!resolved) return null
      warnIfMissingPublic(raw, resolved)
      return createStringLiteral(resolved, exprNode.span)
    }

    const staticallyEvaluated = evalStaticString(exprNode)

    if (typeof staticallyEvaluated === 'string') {
      const resolved = maybeResolve(staticallyEvaluated)

      if (resolved) {
        warnIfMissingPublic(staticallyEvaluated, resolved)
        return createStringLiteral(resolved, exprNode.span)
      }
    }

    if (exprNode.type === 'ArrayExpression') {
      let changed = false

      const elements = (exprNode.elements || []).map((elementNode: any) => {
        if (!elementNode) return elementNode

        const elementExpr = elementNode.expression ?? elementNode
        if (!elementExpr || elementNode.type === 'SpreadElement')
          return elementNode

        const rewritten = rewriteExpression(elementExpr, allowObjectValueDeep)
        if (rewritten) {
          changed = true
          return {type: 'Expression', expression: rewritten}
        }

        return elementNode
      })

      return changed ? {...exprNode, elements} : null
    }

    if (exprNode.type === 'ObjectExpression') {
      let changed = false

      const properties = (exprNode.properties || []).map(
        (propertyNode: any) => {
          if (propertyNode.type !== 'KeyValueProperty') return propertyNode
          const propertyKey =
            propertyNode.key?.type === 'Identifier'
              ? propertyNode.key.value
              : propertyNode.key?.type === 'StringLiteral'
                ? propertyNode.key.value
                : undefined

          if (!allowObjectValueDeep && !propertyKey) return null
          const isAllowedTopLevel = propertyKey
            ? ALLOWED_KEYS.has(propertyKey)
            : false

          if (!isAllowedTopLevel && !allowObjectValueDeep) return propertyNode
          // if (debug) {
          //   try {
          //     console.log(
          //       '[resolve-paths-loader] found object key',
          //       propertyKey,
          //       'valueType',
          //       propertyNode.value?.type
          //     )
          //   } catch {}
          // }
          const rewritten = rewriteExpression(
            propertyNode.value,
            isAllowedTopLevel || allowObjectValueDeep
          )

          if (rewritten) {
            changed = true
            return {...propertyNode, value: rewritten}
          }

          return propertyNode
        }
      )
      return changed ? {...exprNode, properties} : null
    }

    return null
  }

  const visit = (currentNode: any) => {
    if (!currentNode || typeof currentNode !== 'object') return

    if (currentNode.type === 'CallExpression') {
      currentNode.arguments = (currentNode.arguments || []).map(
        (argument: any) => {
          if (!argument) return argument
          const argumentExpression = argument.expression ?? argument
          const rewritten = rewriteExpression(argumentExpression)
          if (!rewritten) return argument
          return argument && 'expression' in argument
            ? {...argument, expression: rewritten}
            : rewritten
        }
      )
    }

    if (currentNode.type === 'NewExpression') {
      currentNode.arguments = (currentNode.arguments || []).map(
        (argument: any) => {
          if (!argument) return argument
          const argumentExpression = argument.expression ?? argument
          const rewritten = rewriteExpression(argumentExpression)
          if (!rewritten) return argument
          return argument && 'expression' in argument
            ? {...argument, expression: rewritten}
            : rewritten
        }
      )
    }

    if (currentNode.type === 'VariableDeclarator' && currentNode.init) {
      const rewritten = rewriteExpression(currentNode.init)
      if (rewritten) currentNode.init = rewritten
    }

    if (currentNode.type === 'AssignmentExpression' && currentNode.right) {
      const rewritten = rewriteExpression(currentNode.right)
      if (rewritten) currentNode.right = rewritten
    }

    for (const key in currentNode) {
      if (!Object.prototype.hasOwnProperty.call(currentNode, key)) continue
      const childNode = (currentNode as any)[key]
      if (!childNode) continue
      if (Array.isArray(childNode)) childNode.forEach(visit)
      else if (childNode && typeof childNode.type === 'string') visit(childNode)
    }
  }

  visit(programAst)

  try {
    const enableMaps =
      sourceMapsOpt === 'auto'
        ? Boolean(this.sourceMap)
        : Boolean(sourceMapsOpt)
    const {code, map} = await swcModule.print(programAst, {
      minify: false,
      sourceMaps: enableMaps,
      filename: this.resourcePath,
      sourceFileName: this.resourcePath
    })

    return callback(null, code, map)
  } catch {
    return callback(null, source)
  }
}

export type ResolvePathsOptions = {
  manifestPath: string
  sourceMaps?: 'auto' | boolean
  debug?: boolean
}
