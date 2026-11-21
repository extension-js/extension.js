// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {isGeckoBasedBrowser} from './constants'

export function stripBom(text: string | Buffer): string {
  const raw = typeof text === 'string' ? text : String(text || '')

  return raw && raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
}

// What a reader of user-authored JSON returns. A caller that knows the shape
// it expects names it as the type argument and still guards each read.
export type ParsedJson = unknown

export interface JsonCommentScan {
  text: string
  hasComments: boolean
  firstBlockComment: number
}

// Comments become spaces of the same length, so every offset, line and
// column JSON.parse reports still points at the file as the author wrote it.
export function blankJsonComments(source: string | Buffer): JsonCommentScan {
  const raw = stripBom(source)
  let out = ''
  let hasComments = false
  let firstBlockComment = -1
  let i = 0

  while (i < raw.length) {
    const char = raw[i]

    if (char === '"') {
      let j = i + 1

      while (j < raw.length && raw[j] !== '"' && raw[j] !== '\n') {
        j += raw[j] === '\\' ? 2 : 1
      }

      out += raw.slice(i, j + 1)
      i = j + 1
      continue
    }

    if (char === '/' && raw[i + 1] === '/') {
      let j = i

      while (j < raw.length && raw[j] !== '\n' && raw[j] !== '\r') j++

      out += ' '.repeat(j - i)
      hasComments = true
      i = j
      continue
    }

    if (char === '/' && raw[i + 1] === '*') {
      const end = raw.indexOf('*/', i + 2)

      // An unterminated comment stays in place and fails the parse there.
      if (end !== -1) {
        out += raw.slice(i, end + 2).replace(/[^\r\n]/g, ' ')
        hasComments = true
        if (firstBlockComment === -1) firstBlockComment = i

        i = end + 2
        continue
      }
    }

    out += char
    i++
  }

  return {text: out, hasComments, firstBlockComment}
}

export function hasJsonComments(source: string | Buffer): boolean {
  return blankJsonComments(source).hasComments
}

function lineAndColumn(text: string, offset: number): string {
  const before = text.slice(0, offset).split('\n')

  return `line ${before.length} column ${before[before.length - 1].length + 1}`
}

// Reads manifest.json and locale files the way the browsers do: both engine
// families read // comments, only Chromium reads /* */, neither a trailing comma.
export function parseAuthoredJson<T = ParsedJson>(
  source: string | Buffer,
  options: {browser?: string; emptyAsObject?: boolean} = {}
): T {
  const scan = blankJsonComments(source)

  if (
    scan.firstBlockComment !== -1 &&
    options.browser &&
    isGeckoBasedBrowser(String(options.browser))
  ) {
    throw new SyntaxError(
      `Firefox does not read a /* */ block comment, found at ${lineAndColumn(scan.text, scan.firstBlockComment)}. ` +
        'Write it as // line comments, which Chromium and Firefox both read'
    )
  }

  return JSON.parse(options.emptyAsObject && !scan.text ? '{}' : scan.text)
}

// parseAuthoredJson where empty input parses as {}; invalid JSON still
// throws. Use parseAuthoredJson where empty must stay an error.
export function parseJsonSafe<T = ParsedJson>(text: string | Buffer): T {
  return parseAuthoredJson<T>(text, {emptyAsObject: true})
}
