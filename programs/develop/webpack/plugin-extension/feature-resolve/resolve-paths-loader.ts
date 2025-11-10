import * as path from 'path'
import * as fs from 'fs'
import type {Program} from '@swc/core'
import {unixify} from './resolve-lib/paths'
import {resolveLiteralToOutput} from './resolve-lib'
import {evalStaticString} from './resolve-lib/ast'
import {handleCallExpression, type RewriteFn} from './resolve-lib/handlers'

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
  const outputPath: string = String(options.outputPath || '')

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
      sourceString.includes('runtime.getURL(') ||
      sourceString.includes('extension.getURL(')
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

    // Parse as a module to allow modern syntax like import.meta
    programAst = await swcModule.parse(source, {
      syntax: isTS ? 'typescript' : 'ecmascript',
      tsx: isTS && isJSX,
      jsx: !isTS && isJSX,
      target: 'es2022',
      isModule: true
    })
  } catch {
    return callback(null, source)
  }

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
      const authorUsedRoot = /^\//.test(canonical)


      if (computed) {
        const root = packageJsonDir || path.dirname(manifestPath)
        // Check existence in source public/ because that's what gets emitted
        const sourcePublicAbs = path.join(root, 'public', computed)
        if (!fs.existsSync(sourcePublicAbs)) {
          // Compute display path per ERROR_POLICY
          const displayPath =
            authorUsedRoot && outputPath
              ? path.join(outputPath, computed)
              : sourcePublicAbs

          const lines: string[] = [
            'Check the path used in your extension API call.',
            'The path must point to an existing file that will be packaged with the extension.',
            `Found value: ${original ?? ''}`,
            `Resolved path: ${authorUsedRoot && outputPath ? path.join(outputPath, computed) : sourcePublicAbs}`
          ]
          // Optional public-root hint strictly for original leading '/'
          if (authorUsedRoot) {
            lines.push(
              "Paths starting with '/' are resolved from the extension output root (served from public/), not your source directory."
            )
          }

          lines.push('', `NOT FOUND ${displayPath}`)

          emitStandardWarning(String(this.resourcePath), lines)
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

  // Rewriter called only by handler-detected API contexts
  const rewriteValue: RewriteFn = (node, computed, rawInput) => {
    if (!computed) return
    // Emit policy-compliant warning, gated by original authoring
    warnIfMissingPublic(rawInput, computed)
    // Mutate node to a StringLiteral with computed value
    ;(node as any).type = 'StringLiteral'
    ;(node as any).value = computed
    if ((node as any).quasis) (node as any).quasis = []
    if ((node as any).expressions) (node as any).expressions = []
  }

  // Walk AST and delegate to feature handlers for CallExpression nodes
  const walk = (currentNode: any) => {
    if (!currentNode || typeof currentNode !== 'object') return

    if (currentNode.type === 'CallExpression') {
      try {
        handleCallExpression(
          currentNode,
          String(source),
          rewriteValue,
          manifestPath
        )
      } catch {
        // best-effort only
      }
    }

    for (const key in currentNode) {
      if (!Object.prototype.hasOwnProperty.call(currentNode, key)) continue
      const childNode = (currentNode as any)[key]
      if (!childNode) continue
      if (Array.isArray(childNode)) childNode.forEach(walk)
      else if (childNode && typeof childNode.type === 'string') walk(childNode)
    }
  }

  walk(programAst)

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
