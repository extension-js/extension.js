// A small V3 source map reader for specs: decodes the VLQ mappings and
// answers "which source line produced generated line N" with the first
// segment of that line, which is what a line-only devtool records.
const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function vlqDecode(text: string): number[] {
  const values: number[] = []
  let value = 0
  let shift = 0
  for (const char of text) {
    const digit = BASE64.indexOf(char)
    if (digit < 0) throw new Error(`bad VLQ digit ${char}`)
    value += (digit & 0x1f) << shift
    if (digit & 0x20) {
      shift += 5
      continue
    }
    values.push(value & 1 ? -(value >> 1) : value >> 1)
    value = 0
    shift = 0
  }
  return values
}

export interface DecodedMap {
  sources: string[]
  sourcesContent: string[]
  /** generated line (0-based) -> first mapped {source index, source line (0-based)} */
  lines: Array<{sourceIndex: number; sourceLine: number} | null>
}

export function decodeSourceMap(json: string): DecodedMap {
  const map = JSON.parse(json) as {
    sources?: string[]
    sourcesContent?: string[]
    mappings?: string
  }
  const lines: DecodedMap['lines'] = []
  let sourceIndex = 0
  let sourceLine = 0
  let sourceColumn = 0
  for (const group of String(map.mappings || '').split(';')) {
    let first: {sourceIndex: number; sourceLine: number} | null = null
    let generatedColumn = 0
    for (const segment of group.split(',')) {
      if (!segment) continue
      const fields = vlqDecode(segment)
      generatedColumn += fields[0]
      if (fields.length >= 4) {
        sourceIndex += fields[1]
        sourceLine += fields[2]
        sourceColumn += fields[3]
        if (!first) first = {sourceIndex, sourceLine}
      }
    }
    lines.push(first)
  }
  return {
    sources: map.sources || [],
    sourcesContent: map.sourcesContent || [],
    lines
  }
}

/** The original file and 0-based line for a generated line, by the map. */
export function originalFor(
  map: DecodedMap,
  generatedLine: number
): {source: string; line: number} | null {
  const hit = map.lines[generatedLine]
  if (!hit) return null
  return {source: map.sources[hit.sourceIndex] || '', line: hit.sourceLine}
}
