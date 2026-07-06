// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {Compilation, type Compiler, sources, WebpackError} from '@rspack/core'
import * as messages from '../messages'

const EMITTED_WORKER_PATH = 'background/service_worker.js'
// importScripts chains resolve against the worker URL, so depth only grows
// through files importing further files — 8 hops is far beyond real usage.
const MAX_TRACE_DEPTH = 8
const SOURCE_SIBLING_EXTENSIONS = ['.ts', '.mts', '.tsx', '.jsx', '.mjs']

export class TraceRuntimeLoadedFiles {
  public readonly manifestPath: string

  constructor(options: {manifestPath: string}) {
    this.manifestPath = options.manifestPath
  }

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      TraceRuntimeLoadedFiles.name,
      (compilation) => {
        // SUMMARIZE runs after minification: the copied files stay verbatim
        // (classic scripts share top-level globals, so they must not be
        // minified or wrapped), and the scan sees the final user bundles but
        // not the dev-server runtimes injected at the REPORT stages (whose
        // chunk-loading code calls importScripts with computed URLs).
        compilation.hooks.processAssets.tap(
          {
            name: TraceRuntimeLoadedFiles.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
          },
          () => {
            this.traceWorkerImportScripts(compilation)
            this.traceInjectedFilePayloads(compilation)
          }
        )
      }
    )
  }

  private readManifest(): Record<string, any> | undefined {
    try {
      return JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'))
    } catch {
      return undefined
    }
  }

  private traceWorkerImportScripts(compilation: Compilation) {
    const manifest = this.readManifest()
    const workerRef = manifest?.background?.service_worker
    // Module workers cannot legally call importScripts.
    if (!workerRef || manifest?.background?.type === 'module') return

    const workerAsset = compilation.getAsset(EMITTED_WORKER_PATH)
    if (!workerAsset) return

    const manifestDir = path.dirname(this.manifestPath)
    const sourceWorkerPath = unixify(String(workerRef)).replace(/^\/+/, '')

    let pending = [workerAsset.source.source().toString()]
    const seen = new Set<string>()

    for (let depth = 0; depth < MAX_TRACE_DEPTH && pending.length; depth++) {
      const next: string[] = []

      for (const content of pending) {
        for (const literal of extractImportScriptsLiterals(content)) {
          const sourceRel = resolveExtensionPath(literal, sourceWorkerPath)
          const distRel = resolveExtensionPath(literal, EMITTED_WORKER_PATH)
          if (!sourceRel || !distRel || seen.has(distRel)) continue
          seen.add(distRel)

          const copied = copyThroughOrWarn(compilation, {
            manifestDir,
            sourceRel,
            distRel,
            warning: (expected, sourceSibling) =>
              messages.importScriptsDependencyMissing(
                sourceWorkerPath,
                literal,
                expected,
                sourceSibling
              ),
            warningName: 'ImportScriptsDependencyMissing',
            warningFile: EMITTED_WORKER_PATH
          })

          // Imported classic scripts may chain further importScripts calls;
          // those still resolve against the worker URL, not the file's own.
          if (copied != null) {
            next.push(copied)

            // wasm-bindgen --target no-modules pairs X.js with X_bg.wasm and
            // fetches it relative to the worker (the first-party Chrome
            // sample does exactly this). The fetch itself is computed, so
            // copy the sibling through when it exists — silently otherwise.
            if (sourceRel.endsWith('.js')) {
              copyIfExists(
                compilation,
                path.join(manifestDir, sourceRel.replace(/\.js$/, '_bg.wasm')),
                distRel.replace(/\.js$/, '_bg.wasm')
              )
            }
          }
        }
      }

      pending = next
    }
  }

  private traceInjectedFilePayloads(compilation: Compilation) {
    const manifestDir = path.dirname(this.manifestPath)
    const seen = new Set<string>()

    // Snapshot first: importScripts tracing above may have emitted classic
    // worker deps, and those can themselves call chrome.scripting APIs.
    const jsAssets = compilation
      .getAssets()
      .filter((asset) => /\.js$/i.test(asset.name))

    for (const asset of jsAssets) {
      const content = asset.source.source().toString()

      for (const literal of extractInjectedFileLiterals(content)) {
        const distRel = resolveExtensionPath(literal, '')
        if (!distRel || seen.has(distRel)) continue
        seen.add(distRel)

        copyThroughOrWarn(compilation, {
          manifestDir,
          sourceRel: distRel,
          distRel,
          warning: (expected, sourceSibling) =>
            messages.injectedFileDependencyMissing(
              asset.name,
              literal,
              expected,
              sourceSibling
            ),
          warningName: 'InjectedScriptFilesMissing',
          warningFile: asset.name
        })
      }
    }
  }
}

/** Copy a file through verbatim when it exists; no warning otherwise. */
function copyIfExists(
  compilation: Compilation,
  abs: string,
  distRel: string
): void {
  if (compilation.getAsset(distRel)) return
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return
  compilation.emitAsset(distRel, new sources.RawSource(fs.readFileSync(abs)))
  try {
    compilation.fileDependencies.add(abs)
  } catch {
    // ignore — watch registration is best-effort
  }
}

/**
 * Copy a runtime-loaded file through to the output verbatim, or push a build
 * warning when the referenced file cannot be found. Returns the file content
 * when a copy happened (callers may want to scan it further), null otherwise.
 */
function copyThroughOrWarn(
  compilation: Compilation,
  opts: {
    manifestDir: string
    sourceRel: string
    distRel: string
    warning: (expectedPath: string, sourceSibling?: string) => string
    warningName: string
    warningFile: string
  }
): string | null {
  // Already produced by the compilation (an emitted chunk or a previously
  // copied file) — nothing to do.
  if (compilation.getAsset(opts.distRel)) return null

  // Files under public/ are copied to the output root by the special-folders
  // pipeline; don't double-emit or warn about those.
  if (fs.existsSync(path.join(opts.manifestDir, 'public', opts.distRel))) {
    return null
  }

  const abs = path.join(opts.manifestDir, opts.sourceRel)

  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
    const buffer = fs.readFileSync(abs)
    compilation.emitAsset(opts.distRel, new sources.RawSource(buffer))
    try {
      compilation.fileDependencies.add(abs)
    } catch {
      // ignore — watch registration is best-effort
    }
    return buffer.toString()
  }

  const sourceSibling = findSourceSibling(abs)
  const warn = new WebpackError(
    opts.warning(
      opts.sourceRel,
      sourceSibling
        ? unixify(path.relative(opts.manifestDir, sourceSibling))
        : undefined
    )
  ) as Error & {file?: string; name?: string}
  warn.name = opts.warningName
  warn.file = opts.warningFile
  compilation.warnings ||= []
  compilation.warnings.push(warn)
  return null
}

/**
 * The literal may have been authored against a source file that compiles to
 * .js (e.g. `injected.ts` referenced as "injected.js"). Surface that in the
 * warning so authors know these files are copied as-is, not compiled.
 */
function findSourceSibling(abs: string): string | undefined {
  if (!abs.endsWith('.js')) return undefined
  const base = abs.slice(0, -'.js'.length)
  return SOURCE_SIBLING_EXTENSIONS.map((ext) => base + ext).find((candidate) =>
    fs.existsSync(candidate)
  )
}

function unixify(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

/**
 * Resolve a runtime URL literal the way the browser does — against a base
 * path inside the extension origin — and return the extension-root-relative
 * output path, or null for anything that isn't a same-origin file reference
 * (remote URLs, other schemes, protocol-relative URLs).
 */
function resolveExtensionPath(
  literal: string,
  basePath: string
): string | null {
  const trimmed = literal.trim()
  if (!trimmed) return null
  if (/^[a-zA-Z][\w+.-]*:/.test(trimmed)) return null
  if (trimmed.startsWith('//')) return null

  try {
    const base = new URL('chrome-extension://extension-js/' + unixify(basePath))
    const resolved = new URL(trimmed, base)
    if (resolved.hostname !== 'extension-js') return null
    const pathname = decodeURIComponent(resolved.pathname).replace(/^\/+/, '')
    return pathname || null
  } catch {
    return null
  }
}

function extractImportScriptsLiterals(source: string): string[] {
  const code = blankComments(source)
  const literals: string[] = []
  const callRe = /\bimportScripts\s*\(/g

  let match: RegExpExecArray | null
  while ((match = callRe.exec(code))) {
    const args = readBalancedArgs(code, match.index + match[0].length - 1)
    if (args == null) continue
    for (const arg of splitTopLevelArgs(args)) {
      const literal = pureStringLiteral(arg)
      // Computed arguments (including the SDK's own chunk-loading runtime)
      // cannot be traced statically — skip them silently.
      if (literal != null) literals.push(literal)
    }
  }

  return literals
}

function extractInjectedFileLiterals(source: string): string[] {
  const code = blankComments(source)
  const literals: string[] = []
  const callRe = /\b(?:executeScript|insertCSS|removeCSS)\s*\(/g

  let match: RegExpExecArray | null
  while ((match = callRe.exec(code))) {
    const args = readBalancedArgs(code, match.index + match[0].length - 1)
    if (args == null) continue

    // MV3 chrome.scripting.* — `files: [...]` arrays of literals.
    const filesRe = /["']?files["']?\s*:\s*\[([^\]]*)\]/g
    let filesMatch: RegExpExecArray | null
    while ((filesMatch = filesRe.exec(args))) {
      for (const element of splitTopLevelArgs(filesMatch[1])) {
        const literal = pureStringLiteral(element)
        if (literal != null) literals.push(literal)
      }
    }

    // MV2 tabs.executeScript / tabs.insertCSS — `file: "..."` singular.
    const fileRe = /["']?file["']?\s*:\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g
    let fileMatch: RegExpExecArray | null
    while ((fileMatch = fileRe.exec(args))) {
      literals.push(unescapeStringBody(fileMatch[2]))
    }
  }

  return literals
}

/**
 * Blank out // and /* *\/ comments (string-aware) so commented-out calls do
 * not produce copies or missing-file warnings. Contents are replaced with
 * spaces to keep offsets stable.
 */
function blankComments(source: string): string {
  let out = ''
  let i = 0
  const n = source.length

  while (i < n) {
    const char = source[i]
    const next = source[i + 1]

    if (char === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out += ' '
        i++
      }
      continue
    }

    if (char === '/' && next === '*') {
      out += '  '
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < n) {
        out += '  '
        i += 2
      }
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      const quote = char
      out += char
      i++
      while (i < n) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '')
          i += 2
          continue
        }
        out += source[i]
        if (source[i] === quote) {
          i++
          break
        }
        i++
      }
      continue
    }

    out += char
    i++
  }

  return out
}

/**
 * Given the index of an opening paren, return the argument text up to the
 * matching close paren (string-aware), or null when unbalanced/oversized.
 */
function readBalancedArgs(code: string, openIndex: number): string | null {
  if (code[openIndex] !== '(') return null
  const cap = Math.min(code.length, openIndex + 5000)
  let depth = 0

  for (let i = openIndex; i < cap; i++) {
    const char = code[i]

    if (char === '"' || char === "'" || char === '`') {
      i = skipString(code, i, cap)
      continue
    }
    if (char === '(') depth++
    if (char === ')') {
      depth--
      if (depth === 0) return code.slice(openIndex + 1, i)
    }
  }

  return null
}

/** Return the index of the closing quote (string-aware skip). */
function skipString(code: string, start: number, cap: number): number {
  const quote = code[start]
  for (let i = start + 1; i < cap; i++) {
    if (code[i] === '\\') {
      i++
      continue
    }
    if (code[i] === quote) return i
  }
  return cap
}

/** Split argument text on top-level commas, tracking nesting and strings. */
function splitTopLevelArgs(args: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''

  for (let i = 0; i < args.length; i++) {
    const char = args[i]

    if (char === '"' || char === "'" || char === '`') {
      const end = skipString(args, i, args.length)
      current += args.slice(i, end + 1)
      i = end
      continue
    }
    if (char === '(' || char === '[' || char === '{') depth++
    if (char === ')' || char === ']' || char === '}') depth--
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }

  if (current.trim()) parts.push(current)
  return parts
}

/**
 * Return the string value when the whole argument is a single static string
 * literal; null for identifiers, concatenations, and template interpolation.
 */
function pureStringLiteral(arg: string): string | null {
  const match = /^\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*$/.exec(arg)
  if (!match) return null
  if (match[1] === '`' && match[2].includes('${')) return null
  return unescapeStringBody(match[2])
}

function unescapeStringBody(body: string): string {
  return body.replace(/\\(.)/g, '$1')
}
