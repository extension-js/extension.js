// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

const BLANKED_MEMO_MIN_LENGTH = 64 * 1024
const BLANKED_MEMO_MAX_ENTRIES = 32
const blankedSources = new Map<string, string>()

// Called when a build's scans are over, so no emitted text outlives them.
export function forgetBlankedSources(): void {
  blankedSources.clear()
}

export function keptBlankedSources(): number {
  return blankedSources.size
}

// Blank out line and block comments (string-aware) so commented-out calls do
// not produce copies or warnings; contents become spaces to keep offsets.
export function blankComments(source: string): string {
  if (source.length < BLANKED_MEMO_MIN_LENGTH) return blankCommentsOf(source)

  const known = blankedSources.get(source)
  if (known !== undefined) return known

  const blanked = blankCommentsOf(source)

  if (blankedSources.size >= BLANKED_MEMO_MAX_ENTRIES) blankedSources.clear()

  blankedSources.set(source, blanked)

  return blanked
}

function blankCommentsOf(source: string): string {
  let out = ''
  let i = 0
  // Where the run of text copied as written starts. It is appended whole,
  // since one append per character is what made this slow on a large script.
  let kept = 0
  const n = source.length

  while (i < n) {
    const char = source[i]
    const next = source[i + 1]

    if (char === '/' && next === '/') {
      const start = i

      while (i < n && source[i] !== '\n') i++

      out += source.slice(kept, start) + ' '.repeat(i - start)
      kept = i

      continue
    }

    if (char === '/' && next === '*') {
      out += `${source.slice(kept, i)}  `
      i += 2

      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' '
        i++
      }

      if (i < n) {
        out += '  '
        i += 2
      }

      kept = i

      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      // The whole string token stays in the copied run, template
      // interpolations included, so nested backticks cannot desync the scan.
      i = skipString(source, i, n) + 1
      continue
    }

    if (char === '/' && regexMayStartAt(source, i)) {
      const end = regexLiteralEnd(source, i, n)

      if (end !== -1) {
        // A pattern can hold `//`, a quote or a lone bracket, and each would
        // send this scan or the next one astray, so those are blanked.
        const body = source.slice(i + 1, end)

        if (REGEX_BODY_NOISE.test(body)) {
          out +=
            source.slice(kept, i + 1) + body.replace(REGEX_BODY_NOISE_ALL, ' ')

          kept = end
        }

        i = end + 1
        continue
      }
    }

    i++
  }

  return kept === 0 ? source : out + source.slice(kept)
}

const REGEX_BODY_NOISE = /['"`()[\]{}]/
const REGEX_BODY_NOISE_ALL = /['"`()[\]{}]/g
// Words a regular expression may follow, where a name would mean division.
const WORDS_BEFORE_REGEX = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await'
])

// Whether the slash at this index can open a regular expression: it follows
// an operator, an opening bracket or one of the words above, never a value.
function regexMayStartAt(source: string, index: number): boolean {
  let j = index - 1

  while (j >= 0 && /\s/.test(source[j])) j--

  if (j < 0) return true

  const before = source[j]

  if (/[\w$]/.test(before)) {
    let start = j

    while (start > 0 && /[\w$]/.test(source[start - 1])) start--

    return WORDS_BEFORE_REGEX.has(source.slice(start, j + 1))
  }

  // A closing bracket or quote ends a value, `<` opens a markup tag and a
  // doubled sign is an increment, so a slash after any of them divides.
  if (')]}\'"`<.'.includes(before)) return false

  if ((before === '+' || before === '-') && source[j - 1] === before) {
    return false
  }

  return true
}

// The index of the slash that closes the pattern opened at this index, or
// -1 when the line ends first, which no regular expression does.
function regexLiteralEnd(source: string, open: number, cap: number): number {
  let inClass = false

  for (let i = open + 1; i < cap; i++) {
    const char = source[i]

    if (char === '\n' || char === '\r') return -1

    if (char === '\\') {
      i++
      continue
    }

    if (char === '[') inClass = true
    else if (char === ']') inClass = false
    else if (char === '/' && !inClass) return i
  }

  return -1
}

// Return the index of the closing quote, skipping template `${...}` blocks;
// without this a nested backtick desyncs every scanner downstream.
export function skipString(code: string, start: number, cap: number): number {
  const quote = code[start]

  for (let i = start + 1; i < cap; i++) {
    if (code[i] === '\\') {
      i++
      continue
    }

    if (code[i] === quote) return i

    if (quote === '`' && code[i] === '$' && code[i + 1] === '{') {
      i = skipTemplateExpression(code, i + 2, cap)
    }
  }

  return cap
}

// Given the index just past `${`, return the index of the matching `}` (or
// cap), skipping nested strings, templates, and object literals.
export function skipTemplateExpression(
  code: string,
  start: number,
  cap: number
): number {
  let depth = 1

  for (let i = start; i < cap; i++) {
    const char = code[i]

    if (char === '"' || char === "'" || char === '`') {
      i = skipString(code, i, cap)
      continue
    }

    // A pattern such as /"/g inside an interpolation opens no string.
    if (char === '/' && regexMayStartAt(code, i)) {
      const end = regexLiteralEnd(code, i, cap)

      if (end !== -1) {
        i = end
        continue
      }
    }

    if (char === '{') depth++

    if (char === '}') {
      depth--
      if (depth === 0) return i
    }
  }

  return cap
}
