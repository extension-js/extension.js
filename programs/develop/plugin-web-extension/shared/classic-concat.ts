// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import {parse} from 'es-module-lexer'

// import( and import.meta are legal in a classic script, so only a static
// import statement counts on the line test the lexer falls back to.
const STATIC_IMPORT_LINE = /^\s*import(?!\s*[(.])[\s{'"*]/m
const EXPORT_LINE = /^\s*export[\s{*( ]/m

function hasImportOrExport(src: string): boolean {
  try {
    const [imports, exports] = parse(src)

    return (
      exports.length > 0 || imports.some((found) => found.type === 'static')
    )
  } catch {
    // The lexer reads plain JavaScript, so JSX gets the line test instead.
    return STATIC_IMPORT_LINE.test(src) || EXPORT_LINE.test(src)
  }
}

// Classic side-by-side scripts share one global scope in the browser; when a
// group is all-classic it is concatenated by the classic-concat loader to match.
export function isClassicScript(filePath: string): boolean {
  try {
    return !hasImportOrExport(fs.readFileSync(filePath, 'utf8'))
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

// The files a concatenated entry was built from, or nothing for any other
// module: its resource is the first file with the whole list in the query.
export function classicConcatFiles(resource: string | undefined): string[] {
  const match = /[?&]__extensionjs_classic_concat__=([^&]+)/.exec(
    resource || ''
  )
  if (!match) return []

  try {
    const data = JSON.parse(decodeURIComponent(match[1]))

    return Array.isArray(data?.js) ? data.js.map(String) : []
  } catch {
    return []
  }
}
