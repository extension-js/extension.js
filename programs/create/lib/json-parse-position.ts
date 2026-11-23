//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

interface JsonParseFailure {
  line: number
  column: number
  atEnd: boolean
}

const WHITESPACE = ' \t\n\r'
const ESCAPES = '"\\/bfnrt'
const HEX = /^[0-9a-fA-F]$/
const DIGIT = /^[0-9]$/

// Where strict JSON stops parsing in this text, or undefined when it parses.
// Node's own message quotes the text and changes shape between versions.
export function jsonParseFailure(text: string): JsonParseFailure | undefined {
  const n = text.length
  const stack: string[] = []
  let i = 0

  const at = (offset: number): JsonParseFailure => {
    const before = text.slice(0, offset).split('\n')

    return {
      line: before.length,
      column: before[before.length - 1].length + 1,
      atEnd: offset >= n
    }
  }

  const skipWhitespace = () => {
    while (i < n && WHITESPACE.includes(text[i])) i++
  }

  const digits = () => {
    const start = i

    while (i < n && DIGIT.test(text[i])) i++

    return i > start
  }

  // Each reader leaves i on the first character it refuses.
  const readString = (): boolean => {
    i++

    while (i < n) {
      const char = text[i]

      if (char === '"') {
        i++

        return true
      }

      if (char.charCodeAt(0) < 0x20) return false

      if (char !== '\\') {
        i++
        continue
      }

      i++
      if (i >= n) return false

      if (ESCAPES.includes(text[i])) {
        i++
        continue
      }

      if (text[i] !== 'u') return false

      i++

      for (let k = 0; k < 4; k++, i++) {
        if (i >= n || !HEX.test(text[i])) return false
      }
    }

    return false
  }

  const readNumber = (): boolean => {
    if (text[i] === '-') i++
    if (text[i] === '0') i++
    else if (!digits()) return false

    if (text[i] === '.') {
      i++
      if (!digits()) return false
    }

    if (text[i] === 'e' || text[i] === 'E') {
      i++
      if (text[i] === '+' || text[i] === '-') i++
      if (!digits()) return false
    }

    return true
  }

  const readWord = (word: string): boolean => {
    for (const char of word) {
      if (text[i] !== char) return false

      i++
    }

    return true
  }

  const readKey = (): boolean => {
    skipWhitespace()
    if (text[i] !== '"' || !readString()) return false

    skipWhitespace()
    if (text[i] !== ':') return false

    i++

    return true
  }

  // One loop with an explicit stack, so deep nesting cannot overflow it.
  for (;;) {
    skipWhitespace()

    const char = text[i]
    let complete = true

    if (char === '{' || char === '[') {
      i++
      skipWhitespace()

      if (text[i] === (char === '{' ? '}' : ']')) {
        i++
      } else {
        stack.push(char)
        if (char === '{' && !readKey()) return at(i)

        complete = false
      }
    } else if (char === '"') {
      if (!readString()) return at(i)
    } else if (char === '-' || (char !== undefined && DIGIT.test(char))) {
      if (!readNumber()) return at(i)
    } else if (char === 't' || char === 'f' || char === 'n') {
      const word = char === 't' ? 'true' : char === 'f' ? 'false' : 'null'

      if (!readWord(word)) return at(i)
    } else {
      return at(i)
    }

    if (!complete) continue

    for (;;) {
      skipWhitespace()

      if (stack.length === 0) return i < n ? at(i) : undefined

      const open = stack[stack.length - 1]

      if (text[i] === ',') {
        i++
        if (open === '{' && !readKey()) return at(i)

        break
      }

      if (text[i] !== (open === '{' ? '}' : ']')) return at(i)

      i++
      stack.pop()
    }
  }
}

// The reason a text is not JSON, by position only, so no byte of the file
// reaches a terminal, a JSON frame or a log.
export function describeJsonParseFailure(text: string): string {
  const failure = jsonParseFailure(text)

  if (!failure) return 'not valid JSON'

  const where = `line ${failure.line} column ${failure.column}`

  return failure.atEnd
    ? `unexpected end of the file at ${where}`
    : `unexpected character at ${where}`
}

// A read that failed is named by its errno code. Anything else is a parse
// failure of the text, when the caller read it.
export function describeJsonReadFailure(error: unknown, text?: string): string {
  const code = (error as {code?: unknown} | null)?.code

  if (typeof code === 'string' && /^E[A-Z0-9_]+$/.test(code)) return code

  return text === undefined ? 'not valid JSON' : describeJsonParseFailure(text)
}
