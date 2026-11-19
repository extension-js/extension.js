// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import type {Compiler} from '@rspack/core'
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

const CONCAT_QUERY = /[?&]__extensionjs_classic_concat__=([^&]+)/

// The files a concatenated entry was built from, or nothing for any other
// module: its resource is a file of the list with the whole list in the query.
export function classicConcatFiles(resource: string | undefined): string[] {
  const match = CONCAT_QUERY.exec(resource || '')
  if (!match) return []

  try {
    const data = JSON.parse(decodeURIComponent(match[1]))

    return Array.isArray(data?.js) ? data.js.map(String) : []
  } catch {
    return []
  }
}

// The request a concatenated entry resolves with. A module needs a file on
// disk to carry its query, so a deleted one hands over to the next one left.
export function classicConcatRequest(request: string, loader?: string): string {
  const match = CONCAT_QUERY.exec(request)
  if (!match || fs.existsSync(request.slice(0, match.index))) return request

  const query = request.slice(match.index)
  const carrier = classicConcatFiles(request).find((file) =>
    fs.existsSync(file)
  )
  if (carrier) return `${carrier}${query}`

  // With every file gone the loader carries the query itself, past the
  // rules, so it still runs and watches for the files to return.
  return loader ? `!!${loader}!${loader}${query}` : request
}

// Keeps a concatenated entry building after the file it is named for is
// deleted. The loader leaves that file out and watches for its return.
export class ResolveClassicConcat {
  private readonly loader?: string

  constructor(options: {loader?: string} = {}) {
    this.loader = options.loader
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.compilation.tap(
      'shared:resolve-classic-concat',
      (_compilation, {normalModuleFactory}) => {
        normalModuleFactory.hooks.beforeResolve.tap(
          'shared:resolve-classic-concat',
          (resolveData) => {
            resolveData.request = classicConcatRequest(
              resolveData.request,
              this.loader
            )
          }
        )
      }
    )
  }
}
