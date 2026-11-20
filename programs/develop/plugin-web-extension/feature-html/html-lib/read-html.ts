// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {isUtf8} from 'node:buffer'
import * as fs from 'node:fs'

export interface HtmlRead {
  // The page as text, always fit to be written as UTF-8.
  text: string
  // 'utf-8' for a page read as written, 'converted' for one decoded from
  // the encoding it declares, 'undecodable' for one nothing could decode.
  outcome: 'utf-8' | 'converted' | 'undecodable'
  // The encoding the page declares, by its byte order mark or its meta tag.
  declared?: string
}

// The charset of a meta tag, in either of the two forms HTML allows.
const META_CHARSET =
  /(<meta\b[^>]*?\bcharset\s*=\s*["']?\s*)([A-Za-z0-9_.:-]+)/i

function declaredEncoding(bytes: Buffer): string | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'

  // A browser looks for the tag in the first 1024 bytes, read as ASCII.
  return META_CHARSET.exec(bytes.subarray(0, 1024).toString('latin1'))?.[2]
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
  const isUtf8Label = /^utf-?8$/i.test(declared || '')
  const decoded = declared && !isUtf8Label ? decode(bytes, declared) : undefined

  if (decoded === undefined) {
    return {text: bytes.toString('utf8'), outcome: 'undecodable', declared}
  }

  return {
    text: decoded.replace(META_CHARSET, '$1utf-8'),
    outcome: 'converted',
    declared
  }
}

export function readHtmlText(file: string): string {
  return readHtml(file).text
}
