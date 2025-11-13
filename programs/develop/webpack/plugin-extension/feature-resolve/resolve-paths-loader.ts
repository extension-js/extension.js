import * as path from 'path'
import * as fs from 'fs'
import MagicString from 'magic-string'
import type {Program} from '@swc/core'
import {unixify} from './resolve-lib/paths'
import {resolveLiteralToOutput} from './resolve-lib'
import {handleCallExpression, type RewriteFn} from './resolve-lib/handlers'
import {createRequire} from 'module'

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
    // Fallback to CJS require for environments where dynamic import fails
    try {
      // Prefer native require when available (CommonJS test runners)
      // eslint-disable-next-line @typescript-eslint/no-var-requires, no-undef
      const mod: any =
        // allow require in CJS
        (typeof require === 'function' && require('@swc/core')) ||
        // Else use createRequire with best-effort context
        createRequire(
          // __filename exists in CJS
          typeof __filename !== 'undefined' ? __filename : import.meta.url
        )('@swc/core')

      const candidateModule =
        mod?.default && mod.default.parse ? mod.default : mod
      if (candidateModule?.parse && candidateModule?.print) {
        swcRuntimeModule = candidateModule
        return swcRuntimeModule
      }
    } catch {
      console.error('Failed to load @swc/core')
    }
  }

  return null
}

function textFallbackTransform(
  source: string,
  opts: {manifestPath: string; packageJsonDir?: string; authorFilePath?: string}
): string {
  const {manifestPath, packageJsonDir, authorFilePath} = opts
  let out = String(source)

  const replaceLiteral = (_match: string, q: string, p: string): string => {
    try {
      const resolved = resolveLiteralToOutput(p, {
        manifestPath,
        packageJsonDir,
        authorFilePath
      })
      return resolved ? `${q}${resolved}${q}` : `${q}${p}${q}`
    } catch {
      return `${q}${p}${q}`
    }
  }

  // runtime/extension.getURL('...')
  out = out.replace(
    /(\.(?:runtime|extension)\.getURL\()\s*(['"])(.*?)\2(\))/g,
    (full, pre, q, p, post) => {
      try {
        const resolved = resolveLiteralToOutput(p, {
          manifestPath,
          packageJsonDir,
          authorFilePath
        })
        return `${pre}${q}${resolved ?? p}${q}${post}`
      } catch {
        return full
      }
    }
  )

  // Object keys we support
  const keys = [
    'url',
    'file',
    'path',
    'popup',
    'panel',
    'page',
    'iconUrl',
    'imageUrl',
    'default_icon',
    'default_popup',
    'default_panel'
  ]

  for (const key of keys) {
    const rx = new RegExp(`(${key}\\s*:\\s*)(['"])(.*?)\\2`, 'g')
    out = out.replace(rx, (full, pre, q, p) => {
      try {
        const resolved = resolveLiteralToOutput(p, {
          manifestPath,
          packageJsonDir,
          authorFilePath
        })
        return `${pre}${q}${resolved ?? p}${q}`
      } catch {
        return full
      }
    })
  }

  // files: ['a.js', '../scripts/x.ts']
  out = out.replace(
    /(files\s*:\s*\[)([^\]]*)(\])/g,
    (full: string, pre: string, inner: string, post: string) => {
      try {
        const replacedInner = inner.replace(
          /(['"])(.*?)(\1)/g,
          (m: string, q: string, p: string) => replaceLiteral(m, q, p)
        )
        return `${pre}${replacedInner}${post}`
      } catch {
        return full
      }
    }
  )

  // js/css arrays in registerContentScripts
  for (const key of ['js', 'css']) {
    const rxArr = new RegExp(`(${key}\\s*:\\s*\\[)([^\\]]*)(\\])`, 'g')
    out = out.replace(rxArr, (full, pre, inner, post) => {
      try {
        const replacedInner = String(inner).replace(
          /(['"])(.*?)(\1)/g,
          (m: string, q: string, p: string) => replaceLiteral(m, q, p)
        )
        return `${pre}${replacedInner}${post}`
      } catch {
        return full
      }
    })
  }

  // Global safe literal cleanup for '/public/...', 'public/...', and leading '/...'
  out = out.replace(/(['"])\/public\/(.*?)\1/g, (_m, q, p) => `${q}${p}${q}`)
  out = out.replace(/(['"])public\/(.*?)\1/g, (_m, q, p) => `${q}${p}${q}`)
  out = out.replace(/(['"])\/(?!\/)([^'"]*?)\1/g, (_m, q, p) => `${q}${p}${q}`)

  // Extension normalization for pages/ and scripts/ literals
  out = out.replace(
    /(['"])((?:pages|scripts)\/[^'"]+?)\.(ts|tsx)\1/g,
    (_m, q, p) => `${q}${p}.js${q}`
  )
  out = out.replace(
    /(['"])((?:pages|scripts)\/[^'"]+?)\.(njk|nunjucks)\1/g,
    (_m, q, p) => `${q}${p}.html${q}`
  )
  out = out.replace(
    /(['"])((?:pages|scripts)\/[^'"]+?)\.(scss|sass|less)\1/g,
    (_m, q, p) => `${q}${p}.css${q}`
  )

  return out
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
      // chrome./browser. with dot member access
      /(?:^|[^A-Za-z0-9_$])(chrome|browser)\s*\./.test(sourceString) ||
      // runtime.getURL or extension.getURL
      /(?:^|[^A-Za-z0-9_$])(?:runtime|extension)\s*\.?\s*getURL\s*\(/.test(
        sourceString
      ) ||
      // common literal indicators for special folders and public-root paths
      /(?:^|[^A-Za-z0-9_$])\/public\//.test(sourceString) ||
      /(?:^|[^A-Za-z0-9_$])public\//.test(sourceString) ||
      /(?:^|[^A-Za-z0-9_$])\/pages\//.test(sourceString) ||
      /(?:^|[^A-Za-z0-9_$])pages\//.test(sourceString) ||
      /(?:^|[^A-Za-z0-9_$])\/scripts\//.test(sourceString) ||
      /(?:^|[^A-Za-z0-9_$])scripts\//.test(sourceString)
    if (!containsEligiblePatterns) return callback(null, source)
  } catch {
    console.error('Failed to check for eligible patterns')
  }

  const swcModule = await loadSwc()

  if (!swcModule) {
    // Best-effort textual fallback for environments where SWC can't load
    try {
      const out = textFallbackTransform(String(source), {
        manifestPath,
        packageJsonDir,
        authorFilePath: String(this.resourcePath || '')
      })
      return callback(null, out)
    } catch {
      return callback(null, source)
    }
  }

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

  const ms = new MagicString(String(source))
  let edited = false

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
        // Skip public-asset existence checks for special folders that are
        // emitted by the bundler (pages/ and scripts/). These are not expected
        // to exist under source public/ and should not warn.
        if (/^(?:pages|scripts)\//i.test(computed)) {
          return
        }
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
    // If a handler didn't compute an output, try resolving again here
    // with additional context (authoring file path and packageJsonDir).
    if (!computed && typeof rawInput === 'string') {
      try {
        const recomputed = resolveLiteralToOutput(rawInput, {
          manifestPath,
          packageJsonDir,
          // Use the current resource path so '../' can be normalized properly
          // relative to the authoring file, not the manifest root.
          authorFilePath: String(this.resourcePath || '')
        })
        if (recomputed) computed = recomputed
      } catch {
        // best-effort only
      }
    }
    if (!computed) return
    // Emit policy-compliant warning, gated by original authoring
    warnIfMissingPublic(rawInput, computed)
    // Overwrite the original literal span with a JSON-encoded string
    try {
      const span = (node as any)?.span
      if (
        span &&
        typeof span.start === 'number' &&
        typeof span.end === 'number'
      ) {
        ms.overwrite(span.start, span.end, JSON.stringify(computed))
        edited = true
      }
    } catch {
      // best-effort only
    }
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
    if (!edited) {
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

export type ResolvePathsOptions = {
  manifestPath: string
  sourceMaps?: 'auto' | boolean
  debug?: boolean
}
