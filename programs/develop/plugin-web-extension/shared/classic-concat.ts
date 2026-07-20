// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'fs'

/**
 * Classic scripts loaded side by side (content_scripts arrays, multiple
 * <script src> tags in one HTML page) share a single global scope in the
 * browser: a top-level `var storage` in one file is visible to its siblings.
 * Bundling each file as a separate ES module isolates those scopes and breaks
 * the implicit cross-file globals. When every file in a group is classic (no
 * top-level import/export), the group is concatenated into one module by the
 * classic-concat loader instead, matching browser semantics.
 */
export function isClassicScript(filePath: string): boolean {
  try {
    const src = fs.readFileSync(filePath, 'utf8')
    return !/^\s*import[\s{('"*]/m.test(src) && !/^\s*export[\s{*( ]/m.test(src)
  } catch {
    return false
  }
}

/**
 * Build the stub entry the classic-concat loader consumes. Instead of baking
 * file contents into a data: URI (which rspack never watches and cannot
 * source-map), the stub resolves to a real file (the first one) carrying a
 * query with the full file list; the loader reads each file via addDependency
 * (enabling watch-mode rebuilds) and generates a V3 source map.
 */
export function classicConcatEntry(feature: string, jsFiles: string[]): string {
  // Chrome DEDUPES a file listed twice in one content_scripts `js` array, it
  // injects it exactly once (verified live on Chrome 150: the same file listed
  // twice executes once, no error). Concatenating it twice instead redeclares
  // its top-level bindings and makes the whole group a SyntaxError
  // ("Identifier 'NativeSkipper' has already been declared"), so an extension
  // that runs fine in Chrome failed to build, wild:
  // ThomasTavernier/Improve-Crunchyroll lists .../skippers/skippers.js twice.
  // First occurrence wins, preserving execution order.
  const deduped = [...new Set(jsFiles)]
  const queryData = encodeURIComponent(
    JSON.stringify({feature, js: deduped, css: []})
  )
  return `${deduped[0]}?__extensionjs_classic_concat__=${queryData}`
}
