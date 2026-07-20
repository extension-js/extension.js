// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

// Classic content-script concatenation loader.
//
// When a content script entry consists of multiple plain JS files (no
// import/export), the browser injects them in order into one world so they
// share a single global scope. ES-module sequencing (`import "a"; import "b"`)
// would isolate each file and break those implicit cross-file globals.
//
// This loader concatenates the sources at build time (matching browser
// semantics), registers each original file via `addDependency` so rspack's
// watcher triggers a rebuild on save, and emits a V3 source map so errors
// trace back to the real file and line.

import * as fs from 'fs'
import {createRequire} from 'module'

const requireModule = createRequire(import.meta.url)

// A classic-concat group member may be a TypeScript source (a tsc-compiled
// extension re-pointed at its sources: background.scripts [bloomfilter.ts,
// background.ts]). Raw TS in the concatenated output is a JS parse error
// ("Unexpected token `:`"), so strip types per file before concatenating.
//
// This uses the swc that rspack already bundles (`@rspack/core` is a declared
// dependency, so nothing extra ships) rather than the TypeScript compiler:
// TypeScript 7 is the native port and its npm package no longer exports a JS
// API at all, and the 24MB `typescript` dependency existed solely for this
// file. swc is loaded lazily so plain-JS groups never pay for it.
//
// `isModule: false` is what keeps classic (non-module) semantics, and it also
// avoids the `"use strict"` prologue tsc emitted here. That prologue was a
// latent bug: the concat wrapper puts every member inside one function body and
// comments do not interrupt a directive prologue, so a .ts file sorted FIRST in
// a group silently made every other file in that group strict, breaking classic
// scripts that assign implicit globals.
function transpileClassicTs(file: string, content: string): string {
  const {experiments} = requireModule('@rspack/core')
  return experiments.swc.transformSync(content, {
    filename: file,
    jsc: {parser: {syntax: 'typescript'}, target: 'esnext'},
    isModule: false,
    sourceMaps: false
  }).code
}

// Names that must never be bridged onto the global: the four UMD-shadowing
// wrapper params (bridging them would undo the module-system neutralization
// above) plus the global aliases themselves.
const EXPOSE_SKIP = new Set([
  'module',
  'exports',
  'define',
  'require',
  'globalThis',
  'window',
  'self',
  'this'
])

// Scopes whose bodies never leak a binding to the page global: a `var` inside
// a function or class body is local to it. Blocks (if/for/try/switch/label)
// are deliberately NOT here. `var` hoists straight out of them.
//
// Function/class DECLARATIONS are absent on purpose: the branch in visit()
// above handles them (it records the name, then returns without descending),
// so listing them here would be unreachable.
const OPAQUE_SCOPES = new Set([
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassExpression'
])

// Node keys that carry position/comment data rather than child nodes.
const NON_CHILD_KEYS = new Set(['type', 'start', 'end', 'loc', 'range'])

export function collectClassicGlobalNames(
  _file: string,
  content: string
): string[] {
  // acorn parses JavaScript only, which is all this ever sees, because TS
  // members are transpiled above before they reach here (the previous
  // implementation likewise parsed with ScriptKind.JS). It is ~570KB of plain
  // JS with no native binary, where the TypeScript compiler it replaces was
  // 24MB. Loaded lazily to match the transpile path.
  const acorn = requireModule('acorn')
  const ast = acorn.parse(content, {
    ecmaVersion: 'latest',
    // Classic scripts, never modules: the concat gate guarantees no top-level
    // import/export, and script mode keeps sloppy-mode sources parseable.
    sourceType: 'script',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowHashBang: true
  })
  const names: string[] = []

  // A binding target is either a plain identifier or a destructuring pattern;
  // recurse so `var {a, b: {c}, ...rest} = o` contributes a, c and rest.
  const addBindingNames = (node: any): void => {
    if (!node || typeof node.type !== 'string') return
    switch (node.type) {
      case 'Identifier':
        names.push(String(node.name))
        return
      case 'ObjectPattern':
        for (const prop of node.properties) {
          if (!prop) continue
          // RestElement has `argument`; Property has `value` (the binding
          // target, since `key` is the source property name, not a binding).
          addBindingNames(
            prop.type === 'RestElement' ? prop.argument : prop.value
          )
        }
        return
      case 'ArrayPattern':
        for (const element of node.elements) addBindingNames(element)
        return
      case 'AssignmentPattern':
        // `var {a = 1} = o` / `var [b = 2] = arr`. The default is on the right.
        addBindingNames(node.left)
        return
      case 'RestElement':
        addBindingNames(node.argument)
        return
      default:
        return
    }
  }

  const visit = (node: any, topLevel: boolean): void => {
    if (!node || typeof node.type !== 'string') return

    if (node.type === 'VariableDeclaration') {
      // let/const are lexical: only top-level ones are visible to later
      // scripts; a nested var hoists to the global like Chrome does. This one
      // check covers both statements and for/for-in/for-of heads, which the
      // TypeScript implementation needed two separate branches for.
      if (topLevel || node.kind === 'var') {
        for (const declarator of node.declarations) {
          addBindingNames(declarator.id)
        }
      }
      return
    }

    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'ClassDeclaration'
    ) {
      if (topLevel && node.id) names.push(String(node.id.name))
      // Never descend into function/class bodies, their vars stay local.
      return
    }

    if (OPAQUE_SCOPES.has(node.type)) return

    for (const key of Object.keys(node)) {
      if (NON_CHILD_KEYS.has(key)) continue
      const child = node[key]
      if (Array.isArray(child)) {
        for (const item of child) visit(item, false)
      } else {
        visit(child, false)
      }
    }
  }

  for (const statement of ast.body) {
    visit(statement, true)
  }

  return names
}

interface ClassicConcatLoaderContext {
  resourcePath: string
  resourceQuery: string
  addDependency(dep: string): void
  callback(err: Error | null, content?: string, sourceMap?: any): void
}

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Text wrapped around the concatenated classic sources to neutralize the
// CommonJS/AMD module system. See the block comment at the wrap site below.
const CONCAT_UMD_WRAP_OPEN = ';(function (module, exports, define, require) {'
const CONCAT_UMD_WRAP_CLOSE =
  '}).call(typeof globalThis !== "undefined" ? globalThis : this, void 0, void 0, void 0, void 0);'

function vlqEncode(value: number): string {
  let vlq = value < 0 ? (-value << 1) + 1 : value << 1
  let encoded = ''
  do {
    let digit = vlq & 0x1f
    vlq >>>= 5
    if (vlq > 0) digit |= 0x20
    encoded += BASE64[digit]
  } while (vlq > 0)
  return encoded
}

export default function classicConcatLoader(
  this: ClassicConcatLoaderContext,
  _source: string
): void {
  const query = this.resourceQuery || ''
  const match = query.match(/[?&]__extensionjs_classic_concat__=([^&]+)/)
  if (!match) {
    this.callback(null, _source)
    return
  }

  let data: {feature?: string; js?: string[]; css?: string[]}
  try {
    data = JSON.parse(decodeURIComponent(match[1]))
  } catch {
    this.callback(null, _source)
    return
  }

  const jsFiles: string[] = data.js || []
  const cssFiles: string[] = data.css || []
  const feature: string = data.feature || ''

  // Register every JS file as a dependency so rspack's watcher triggers
  // a rebuild when any of them change on disk.
  for (const file of jsFiles) {
    this.addDependency(file)
  }

  // Build concatenated output, tracking per-line source mappings.
  const outputLines: string[] = []
  const lineMappings: Array<{sourceIndex: number; sourceLine: number} | null> =
    []
  const sources: string[] = []
  const sourcesContent: string[] = []

  // CSS imports (processed by rspack as normal module imports)
  for (const css of cssFiles) {
    outputLines.push(`import ${JSON.stringify(String(css))};`)
    lineMappings.push(null)
  }

  // Wrap the concatenated classic sources in a function whose parameters shadow
  // the CommonJS/AMD module system, then call it with all four undefined.
  //
  // Why: rspack wraps this entry in a module closure where `require`/`module`/
  // `exports` are real (rspack's own require, and a module object). A vendored
  // UMD lib (katex, jszip, markdown-it, FileSaver…) would then (a) have rspack
  // *statically* collect its top-level `require('katex')` and fail with "Module
  // not found: Can't resolve 'katex'", and (b) at runtime see `typeof module ===
  // 'object'` and run its Node branch instead of the browser-global branch it
  // must take in a content script.
  //
  // Making `require`/`module`/`exports`/`define` function parameters fixes both:
  // rspack treats a locally-bound `require` as an ordinary variable and does NOT
  // collect its calls, and at runtime the guards see `undefined` and fall back to
  // the global, exactly as when these files are injected as plain classic
  // scripts. Browserify/webpack-bundled libs keep working too: their *inner*
  // `function (require, module, exports)` params still shadow within their own
  // scope, so their self-contained relative requires resolve internally.
  //
  // `.call(globalThis, …)` keeps top-level `this` pointing at the global, matching
  // classic-script semantics. Both wrapper lines map to null so the per-line
  // source map for the real files stays accurate.
  outputLines.push(CONCAT_UMD_WRAP_OPEN)
  lineMappings.push(null)

  // Feature header comment
  if (feature) {
    outputLines.push(
      `/* extension.js classic content-script concatenation: ${feature} */`
    )
    lineMappings.push(null)
  }

  // Read and concatenate JS files
  const globalNames: string[] = []
  for (let fileIdx = 0; fileIdx < jsFiles.length; fileIdx++) {
    const file = jsFiles[fileIdx]
    const raw = fs.readFileSync(file, 'utf8')
    // Line mappings for transpiled TS are approximate (tsc's emitter mostly
    // preserves line positions, but removed type-only blocks shift them).
    const content = /\.ts$/i.test(file) ? transpileClassicTs(file, raw) : raw
    try {
      globalNames.push(...collectClassicGlobalNames(file, content))
    } catch {
      // A file the parser chokes on still concatenates; it just gets no
      // global bridge.
    }
    sources.push(file)
    sourcesContent.push(raw)

    // Per-file comment separator
    outputLines.push(`/* ${file} */`)
    lineMappings.push(null)

    // File content, each line maps 1:1 to the original source file
    const fileLines = content.split('\n')
    for (let lineNo = 0; lineNo < fileLines.length; lineNo++) {
      outputLines.push(fileLines[lineNo])
      lineMappings.push({sourceIndex: fileIdx, sourceLine: lineNo})
    }

    // Semicolon guard between files to prevent ASI issues
    if (fileIdx < jsFiles.length - 1) {
      outputLines.push(';')
      lineMappings.push(null)
    }
  }

  // In the browser these files run as classic scripts, so their top-level
  // declarations land on the page's global, an inline <script> on the same
  // page (or any later non-bundled script) consumes them from there. The
  // wrapper above made them function-scoped, so bridge each collected name
  // back onto globalThis before the wrapper closes. Property assignment
  // survives minification (the local identifier renames consistently; the
  // property name is quoted).
  const exposedNames = [...new Set(globalNames)].filter(
    (name) => !EXPOSE_SKIP.has(name) && /^[A-Za-z_$][\w$]*$/.test(name)
  )
  if (exposedNames.length > 0) {
    outputLines.push(
      '/* extension.js: classic top-level declarations land on the global (browser parity) */'
    )
    lineMappings.push(null)
    for (const name of exposedNames) {
      outputLines.push(
        `try { globalThis[${JSON.stringify(name)}] = ${name}; } catch (_e) {}`
      )
      lineMappings.push(null)
    }
  }

  // Close the module-system-shadowing wrapper opened above.
  outputLines.push(CONCAT_UMD_WRAP_CLOSE)
  lineMappings.push(null)

  const output = outputLines.join('\n')

  // Generate V3 source map mappings.
  // Each segment encodes: genColumn (always 0), sourceIndex delta,
  // sourceLine delta, sourceColumn delta (always 0).
  let prevSrcIdx = 0
  let prevSrcLine = 0
  const mappingSegments: string[] = []

  for (const mapping of lineMappings) {
    if (mapping === null) {
      mappingSegments.push('')
    } else {
      mappingSegments.push(
        vlqEncode(0) +
          vlqEncode(mapping.sourceIndex - prevSrcIdx) +
          vlqEncode(mapping.sourceLine - prevSrcLine) +
          vlqEncode(0)
      )
      prevSrcIdx = mapping.sourceIndex
      prevSrcLine = mapping.sourceLine
    }
  }

  const sourceMap = {
    version: 3 as const,
    sources,
    sourcesContent,
    mappings: mappingSegments.join(';'),
    names: [] as string[]
  }

  this.callback(null, output, sourceMap)
}
