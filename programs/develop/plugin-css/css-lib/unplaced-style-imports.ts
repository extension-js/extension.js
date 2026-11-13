//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export interface UnplacedStyleImport {
  request: string
  line: number
}

const STYLE_REQUEST = /\.(?:css|scss|sass|less)$/i
const STYLE_MODULE_REQUEST = /\.module\.(?:css|scss|sass|less)$/i
const BARE_IMPORT = /(^|[;{}\n])[ \t]*import[ \t]*(['"])([^'"\n]+)\2/g
// The host a declared content script marks so its sheet reaches the root.
const SHADOW_HOST_MARKER = /\bdata-extension-root\b|\bextension-root\b/

// Comments become spaces of the same length, so every offset and line holds.
// Strings are stepped over, so a "//" inside one never opens a comment.
export function blankComments(source: string): string {
  let out = ''
  let at = 0

  while (at < source.length) {
    const char = source[at]
    const next = source[at + 1]

    if (char === '/' && next === '/') {
      let end = source.indexOf('\n', at)
      if (end === -1) end = source.length

      out += ' '.repeat(end - at)
      at = end
      continue
    }

    if (char === '/' && next === '*') {
      let end = source.indexOf('*/', at + 2)
      end = end === -1 ? source.length : end + 2

      out += source.slice(at, end).replace(/[^\n]/g, ' ')
      at = end
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      let end = at + 1

      while (end < source.length && source[end] !== char) {
        // A quote left open ends with its line, which bounds a misread.
        if (source[end] === '\n' && char !== '`') break

        end += source[end] === '\\' ? 2 : 1
      }

      end = Math.min(end + 1, source.length)
      out += source.slice(at, end)
      at = end
      continue
    }

    out += char
    at++
  }

  return out
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

// A stylesheet a script imports and binds to nothing, in a file that names
// that sheet nowhere else: no new URL(), no require, no second import.
export function findUnplacedStyleImports(
  source: string
): UnplacedStyleImport[] {
  if (!/\bimport\b/.test(source)) return []

  const code = blankComments(source)
  const bare = new Map<string, {line: number; count: number}>()

  for (const match of code.matchAll(BARE_IMPORT)) {
    const request = match[3]

    if (!STYLE_REQUEST.test(request) || STYLE_MODULE_REQUEST.test(request)) {
      continue
    }

    const seen = bare.get(request)

    if (seen) {
      seen.count++
      continue
    }

    const at = (match.index || 0) + match[0].indexOf('import')
    const line = code.slice(0, at).split('\n').length

    bare.set(request, {line, count: 1})
  }

  const unplaced: UnplacedStyleImport[] = []

  for (const [request, {line, count}] of bare) {
    const named = ['"', "'", '`'].reduce(
      (total, quote) =>
        total + countOccurrences(code, `${quote}${request}${quote}`),
      0
    )

    if (named === count) unplaced.push({request, line})
  }

  return unplaced
}

export function namesShadowHost(source: string): boolean {
  return SHADOW_HOST_MARKER.test(source)
}
