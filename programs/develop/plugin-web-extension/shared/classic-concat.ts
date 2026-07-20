// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'

// Classic side-by-side scripts share one global scope in the browser; when a
// group is all-classic it is concatenated by the classic-concat loader to match.
export function isClassicScript(filePath: string): boolean {
  try {
    const src = fs.readFileSync(filePath, 'utf8')
    return !/^\s*import[\s{('"*]/m.test(src) && !/^\s*export[\s{*( ]/m.test(src)
  } catch {
    return false
  }
}

// The stub resolves to a real file carrying the file list in a query (not a
// data: URI): rspack can watch each file and generate a V3 source map.
export function classicConcatEntry(feature: string, jsFiles: string[]): string {
  // Chrome DEDUPES a file listed twice in one content_scripts js array (verified
  // live); concatenating it twice makes a SyntaxError, so first occurrence wins.
  const deduped = [...new Set(jsFiles)]
  const queryData = encodeURIComponent(
    JSON.stringify({feature, js: deduped, css: []})
  )
  return `${deduped[0]}?__extensionjs_classic_concat__=${queryData}`
}
