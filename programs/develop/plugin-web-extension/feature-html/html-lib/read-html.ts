// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {isUtf8} from 'node:buffer'
import * as fs from 'node:fs'

interface HtmlRead {
  // The page as text, always fit to be written as UTF-8.
  text: string
  // 'utf-8' for a page read as written, 'converted' for one decoded from
  // the encoding it declares, 'undecodable' for one nothing could decode.
  outcome: 'utf-8' | 'converted' | 'undecodable'
  // The encoding the page declares, by its byte order mark or its meta tag.
  declared?: string
}

interface DeclaredCharset {
  label: string
  // Where the label starts and ends in the text it was found in.
  start: number
  end: number
}

const LABEL_CHARACTER = /[A-Za-z0-9_.:-]/
const SPACE = /\s/

// The charset of the first meta tag that names one, in either of the two
// forms HTML allows. Scanned by hand so a long page costs one pass.
function metaCharset(text: string): DeclaredCharset | undefined {
  const lower = text.toLowerCase()

  for (
    let tag = lower.indexOf('<meta');
    tag !== -1;
    tag = lower.indexOf('<meta', tag + 5)
  ) {
    const close = lower.indexOf('>', tag)
    const end = close === -1 ? lower.length : close
    let at = lower.indexOf('charset', tag)

    if (at === -1 || at > end) continue

    at += 'charset'.length
    while (at < end && SPACE.test(lower[at])) at += 1
    if (lower[at] !== '=') continue

    at += 1
    while (at < end && SPACE.test(lower[at])) at += 1
    if (lower[at] === '"' || lower[at] === "'") at += 1

    while (at < end && SPACE.test(lower[at])) at += 1

    let stop = at
    while (stop < end && LABEL_CHARACTER.test(text[stop])) stop += 1

    if (stop > at) return {label: text.slice(at, stop), start: at, end: stop}
  }

  return undefined
}

// A browser looks for the tag in the first 1024 bytes, read as ASCII.
const PRESCAN = 1024

function declaredEncoding(bytes: Buffer): string | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'

  return metaCharset(bytes.subarray(0, PRESCAN).toString('latin1'))?.label
}

// The decoded page with the charset its meta tag names set to UTF-8.
function declaringUtf8(text: string): string {
  const found = metaCharset(text.slice(0, PRESCAN))

  return found
    ? `${text.slice(0, found.start)}utf-8${text.slice(found.end)}`
    : text
}

function decode(bytes: Buffer, encoding: string): string | undefined {
  try {
    return new TextDecoder(encoding, {fatal: true}).decode(bytes)
  } catch {
    // An encoding this runtime does not know, or bytes that are not in it
    return undefined
  }
}

// Reads a page so every byte of it survives being written as UTF-8. A page
// in another encoding is decoded from the one it declares and says UTF-8.
export function readHtml(file: string): HtmlRead {
  const bytes = fs.readFileSync(file)

  if (isUtf8(bytes)) return {text: bytes.toString('utf8'), outcome: 'utf-8'}

  const declared = declaredEncoding(bytes)
  const isUtf8Label = ['utf-8', 'utf8'].includes(String(declared).toLowerCase())
  const decoded = declared && !isUtf8Label ? decode(bytes, declared) : undefined

  if (decoded === undefined) {
    return {text: bytes.toString('utf8'), outcome: 'undecodable', declared}
  }

  return {
    text: declaringUtf8(decoded),
    outcome: 'converted',
    declared
  }
}

export function readHtmlText(file: string): string {
  return readHtml(file).text
}
