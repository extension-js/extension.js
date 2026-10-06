//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export interface LineRewriteSourceMap {
  version: 3
  sources: string[]
  sourcesContent: string[]
  names: string[]
  mappings: string
}

function vlq(value: number): string {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1
  let out = ''

  do {
    let digit = rest & 31
    rest >>>= 5
    if (rest > 0) digit |= 32

    out += BASE64[digit]
  } while (rest > 0)

  return out
}

function commonSuffixLength(a: string, b: string, limit: number): number {
  let length = 0

  while (
    length < limit &&
    a[a.length - 1 - length] === b[b.length - 1 - length]
  ) {
    length++
  }

  return length
}

// The map of a rewrite that keeps every line and edits text inside a line
// only: each line maps onto itself and the text after an edit keeps its
// column, with the author's text as the source a devtools panel shows.
export function lineRewriteSourceMap(
  original: string,
  rewritten: string,
  source: string
): LineRewriteSourceMap {
  const originalLines = original.split('\n')
  const rewrittenLines = rewritten.split('\n')
  const lines: string[] = []
  let previousLine = 0
  let previousColumn = 0

  for (let index = 0; index < rewrittenLines.length; index++) {
    const from = originalLines[index] ?? ''
    const to = rewrittenLines[index]
    const segments = [
      `${vlq(0)}${vlq(0)}${vlq(index - previousLine)}${vlq(0 - previousColumn)}`
    ]
    previousLine = index
    previousColumn = 0

    if (from !== to) {
      let prefix = 0

      while (
        prefix < from.length &&
        prefix < to.length &&
        from[prefix] === to[prefix]
      ) {
        prefix++
      }

      const suffix = commonSuffixLength(
        from,
        to,
        Math.min(from.length, to.length) - prefix
      )
      const generatedColumn = to.length - suffix
      const originalColumn = from.length - suffix

      segments.push(
        `${vlq(generatedColumn)}${vlq(0)}${vlq(0)}${vlq(originalColumn)}`
      )

      previousColumn = originalColumn
    }

    lines.push(segments.join(','))
  }

  return {
    version: 3,
    sources: [source],
    sourcesContent: [original],
    names: [],
    mappings: lines.join(';')
  }
}
