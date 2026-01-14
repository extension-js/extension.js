// ██████╗ ███████╗███████╗ ██████╗ ██╗    ██╗   ██╗███████╗
// ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║    ██║   ██║██╔════╝
// ██████╔╝█████╗  ███████╗██║   ██║██║    ██║   ██║█████╗
// ██╔══██╗██╔══╝  ╚════██║██║   ██║██║    ╚██╗ ██╔╝██╔══╝
// ██║  ██║███████╗███████║╚██████╔╝███████╗╚████╔╝ ███████╗
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚══════╝ ╚═══╝  ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import MagicString from 'magic-string'
import type {Program} from '@swc/core'
import {unixify} from '../resolve-lib/paths'
import {resolveLiteralToOutput} from '../resolve-lib'
import {handleCallExpression, type RewriteFn} from '../resolve-lib/handlers'
import {textFallbackTransform} from './text'
import {loadSwc, parseWithSwc} from './ast/swc'

export type ResolvePathsOptions = {
  manifestPath: string
  sourceMaps?: 'auto' | boolean
  debug?: boolean
}

export default async function resolvePathsLoader(this: any, source: string) {
  const callback = this.async()
  const options = this.getOptions?.() || {}
  const manifestPath: string = options.manifestPath as string
  const packageJsonDir: string | undefined = options.packageJsonDir as
    | string
    | undefined
  const outputPath: string = String(options.outputPath || '')

  const sourceMapsOpt: 'auto' | boolean =
    typeof options.sourceMaps === 'boolean' || options.sourceMaps === 'auto'
      ? options.sourceMaps
      : 'auto'

  this.cacheable && this.cacheable()

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
        if (/^(?:pages|scripts)\//i.test(computed)) return
        const root = packageJsonDir || path.dirname(manifestPath)
        const sourcePublicAbs = path.join(root, 'public', computed)

        if (!fs.existsSync(sourcePublicAbs)) {
          const displayPath =
            authorUsedRoot && outputPath
              ? path.join(outputPath, computed)
              : sourcePublicAbs
          const lines: string[] = [
            'Check the path used in your extension API call.',
            'The path must point to an existing file that will be packaged with the extension.',
            `Found value: ${original ?? ''}`,
            `Resolved path: ${
              authorUsedRoot && outputPath
                ? path.join(outputPath, computed)
                : sourcePublicAbs
            }`
          ]

          if (authorUsedRoot) {
            lines.push(
              "Paths starting with '/' are resolved from the extension output root (served from public/), not your source directory."
            )
          }

          lines.push('', `NOT FOUND ${displayPath}`)
          emitStandardWarning(String(this.resourcePath), lines)
        }
      } else if (original) {
        const looksNested =
          /(^|\/)src\/pages\//i.test(canonical) ||
          /(^|\/)src\/scripts\//i.test(canonical)

        if (looksNested) {
          const root = packageJsonDir || path.dirname(manifestPath)
          const abs = path.join(root, canonical)
          const lines: string[] = [
            'Check the path used in your extension API call.',
            'The path must point to an existing file that will be packaged with the extension.',
            `Found value: ${original}`
          ]

          lines.push('', `NOT FOUND ${abs}`)
          emitStandardWarning(String(this.resourcePath), lines)
        }
      }
    } catch {
      // best-effort only
    }
  }

  // Early escapes
  try {
    const resourcePathUnix = unixify(String(this.resourcePath || ''))
    if (resourcePathUnix.split('/').includes('public')) {
      return callback(null, source)
    }
  } catch {
    // best-effort only
  }

  try {
    const sourceString = String(source)
    const containsEligiblePatterns =
      /(?:^|[^A-Za-z0-9_$])(chrome|browser)\s*\./.test(sourceString) ||
      /(?:^|[^A-Za-z0-9_$])(?:runtime|extension)\s*\.?\s*getURL\s*\(/.test(
        sourceString
      ) ||
      /(?:^|[^A-Za-z0-9_$])\/public\//.test(sourceString) ||
      /(?:^|[^A-Za-z0-9_$])public\//.test(sourceString) ||
      /(?:^|[^A-Za-z0-9_$])\/pages\//.test(sourceString) ||
      /(?:^|[^A-Za-z0-9_$])pages\//.test(sourceString) ||
      /(?:^|[^A-Za-z0-9_$])\/scripts\//.test(sourceString) ||
      /(?:^|[^A-Za-z0-9_$])scripts\//.test(sourceString)

    if (!containsEligiblePatterns) return callback(null, source)
  } catch {
    // best-effort only
  }

  // Textual pass
  let postTextSource: string | undefined
  try {
    const out = textFallbackTransform(String(source), {
      manifestPath,
      packageJsonDir,
      authorFilePath: String(this.resourcePath || ''),
      onResolvedLiteral: (original, computed) =>
        warnIfMissingPublic(original, computed)
    })

    postTextSource = out

    const hasStaticTemplates = /`[^$`]*`/.test(out)
    const hasBinaryConcats =
      /(['"`][^'"`]*['"`]\s*\+\s*['"`][^'"`]*['"`])/.test(out)
    const hasApiRoots = /(?:^|[^A-Za-z0-9_$])(chrome|browser)\s*\./.test(out)
    const needsStaticEval =
      (hasStaticTemplates || hasBinaryConcats) && hasApiRoots

    const enableMaps =
      sourceMapsOpt === 'auto'
        ? Boolean(this.sourceMap)
        : Boolean(sourceMapsOpt)

    if (!needsStaticEval) {
      if (
        out !== String(source) ||
        (enableMaps && /\.[cm]?tsx?$/.test(String(this.resourcePath || '')))
      ) {
        const msAll = new MagicString(String(source))
        msAll.overwrite(0, String(source).length, out)

        const map = enableMaps
          ? msAll.generateMap({
              hires: true,
              source: String(this.resourcePath),
              includeContent: true
            })
          : undefined

        return callback(null, out, map as any)
      }
    }
  } catch {
    // best-effort only
  }

  // AST pass (SWC)
  const swc = await loadSwc()
  if (!swc) return callback(null, source)

  let programAst: Program

  try {
    const isTS = /\.[cm]?tsx?$/.test(this.resourcePath)
    const isJSX = /\.[cm]?[jt]sx$/.test(this.resourcePath)
    const parseSource =
      typeof postTextSource === 'string' ? postTextSource : source

    programAst = await parseWithSwc(swc, parseSource, {isTS, isJSX})
  } catch {
    return callback(null, source)
  }

  const inputSource =
    typeof postTextSource === 'string' ? postTextSource : String(source)
  const ms = new MagicString(inputSource)

  let edited = false

  const rewriteValue: RewriteFn = (node, computed, rawInput) => {
    if (!computed && typeof rawInput === 'string') {
      try {
        const recomputed = resolveLiteralToOutput(rawInput, {
          manifestPath,
          packageJsonDir,
          authorFilePath: String(this.resourcePath || '')
        })
        if (recomputed) computed = recomputed
      } catch {
        // best-effort only
      }
    }

    if (!computed) return

    try {
      const span = (node as any)?.span
      if (
        span &&
        typeof span.start === 'number' &&
        typeof span.end === 'number'
      ) {
        const src = String(inputSource)
        const before = src[span.start - 1]
        const after = src[span.end]
        const isQuote = (c: string | undefined) => c === "'" || c === '"'

        if (isQuote(before) && before === after) {
          let start = span.start - 1
          let end = span.end + 1
          const q = before
          const json = JSON.stringify(String(computed))

          if (q === '"') {
            ms.overwrite(start, end, json)
          } else {
            const inner = json.slice(1, -1).replace(/'/g, "\\'")
            ms.overwrite(start, end, `'${inner}'`)
          }
        } else {
          ms.overwrite(span.start, span.end, JSON.stringify(computed))
        }
        edited = true
      }
    } catch {
      // best-effort only
    }
  }

  const walk = (currentNode: any) => {
    if (!currentNode || typeof currentNode !== 'object') return

    if (currentNode.type === 'CallExpression') {
      try {
        handleCallExpression(
          currentNode,
          String(inputSource),
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
    if (!edited) {
      if (
        typeof postTextSource === 'string' &&
        postTextSource !== String(source)
      ) {
        const enableMaps =
          sourceMapsOpt === 'auto'
            ? Boolean(this.sourceMap)
            : Boolean(sourceMapsOpt)
        const msAll = new MagicString(String(source))
        msAll.overwrite(0, String(source).length, postTextSource)

        const map = enableMaps
          ? msAll.generateMap({
              hires: true,
              source: String(this.resourcePath),
              includeContent: true
            })
          : undefined

        return callback(null, postTextSource, map as any)
      }

      return callback(null, source)
    }

    const enableMaps =
      sourceMapsOpt === 'auto'
        ? Boolean(this.sourceMap)
        : Boolean(sourceMapsOpt)
    const code = ms.toString()
    const map = enableMaps
      ? ms.generateMap({
          hires: true,
          source: String(this.resourcePath),
          includeContent: true
        })
      : undefined

    return callback(null, code, map as any)
  } catch {
    return callback(null, source)
  }
}
