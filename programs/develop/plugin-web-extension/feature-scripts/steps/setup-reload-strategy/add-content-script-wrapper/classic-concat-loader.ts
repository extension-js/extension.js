// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

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
const CONCAT_UMD_WRAP_OPEN =
  ';(function (module, exports, define, require) {'
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
  // the global — exactly as when these files are injected as plain classic
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
  for (let fileIdx = 0; fileIdx < jsFiles.length; fileIdx++) {
    const file = jsFiles[fileIdx]
    const content = fs.readFileSync(file, 'utf8')
    sources.push(file)
    sourcesContent.push(content)

    // Per-file comment separator
    outputLines.push(`/* ${file} */`)
    lineMappings.push(null)

    // File content — each line maps 1:1 to the original source file
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
