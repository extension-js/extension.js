//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as acorn from 'acorn'
import {toJsStringLiteral} from './js-literal'

export function escapeForJsonAsset(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

// Walks JSON up to the placeholder and reports whether it sits inside a
// string. Comments are skipped so a quote in one does not flip it.
export function isInsideJsonString(content: string, offset: number): boolean {
  let inString = false

  for (let i = 0; i < offset; i++) {
    const char = content[i]

    if (inString) {
      if (char === '\\') i++
      else if (char === '"') inString = false
    } else if (char === '"') {
      inString = true
    } else if (char === '/' && content[i + 1] === '/') {
      const end = content.indexOf('\n', i)
      if (end === -1 || end >= offset) return false

      i = end
    } else if (char === '/' && content[i + 1] === '*') {
      const end = content.indexOf('*/', i + 2)
      if (end === -1 || end >= offset) return false

      i = end + 1
    }
  }

  return inString
}

// A quoted placeholder takes a JSON string body. A bare one stands where a
// JSON value goes, so it is inserted as written and the caller checks it parses.
export function substituteForJsonAsset(
  content: string,
  offset: number,
  value: string
): string {
  return isInsideJsonString(content, offset) ? escapeForJsonAsset(value) : value
}

// A written carriage return is folded into a line feed before the parser
// sees it, so only its character reference survives.
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '\r': '&#13;'
}

const numericEntity = (char: string) => `&#${char.codePointAt(0)};`
const toEntities = (value: string) =>
  value.replace(/[&<>"'\r]/g, (char) => HTML_ENTITIES[char])

type HtmlSink =
  | {kind: 'text'; rawTag?: string}
  | {kind: 'comment'}
  | {kind: 'tag'}
  | {
      kind: 'attribute'
      name: string
      quote: string
      valueStart: number
      valueEnd: number
    }
  | {kind: 'script'; type: string; textStart: number; textEnd: number}
  | {kind: 'style'; textStart: number}

// Elements whose content the HTML tokenizer never reads as tags.
const RAW_TEXT_ELEMENTS = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'plaintext'
])

const SPACE_OR_TAG_END = /[\s/>]/
const ATTRIBUTE_NAME_END = /[\s/>=]/
const UNQUOTED_VALUE_END = /[\s>]/

// Placeholders are asked about in rising order, so the walk resumes from the
// last spot known to be plain markup instead of from the top each time.
let resume = {content: '', at: 0}

// Follows the HTML tokenizer far enough to name the sink a placeholder is in:
// tags with their quoted values, comments and the raw text elements.
function htmlSinkAt(content: string, offset: number): HtmlSink {
  let i = resume.content === content && resume.at <= offset ? resume.at : 0

  while (i < offset) {
    resume = {content, at: i}

    const lt = content.indexOf('<', i)
    if (lt === -1 || lt >= offset) return {kind: 'text'}

    if (content.startsWith('<!--', lt)) {
      const abrupt = /^<!---?>/.exec(content.slice(lt, lt + 6))
      const close = /--!?>/g
      close.lastIndex = lt + 4
      const found = abrupt ? null : close.exec(content)
      const end = abrupt
        ? lt + abrupt[0].length
        : found
          ? found.index + found[0].length
          : -1

      if (end === -1 || end > offset) return {kind: 'comment'}

      i = end
      continue
    }

    const next = content[lt + 1] || ''

    if (next === '!' || next === '?') {
      const end = content.indexOf('>', lt)
      if (end === -1 || end >= offset) return {kind: 'comment'}

      i = end + 1
      continue
    }

    const closing = next === '/'
    const nameStart = lt + (closing ? 2 : 1)

    if (!/[a-zA-Z]/.test(content[nameStart] || '')) {
      i = lt + 1
      continue
    }

    let j = nameStart
    while (j < content.length && !SPACE_OR_TAG_END.test(content[j])) j++
    if (j > offset) return {kind: 'tag'}

    const tagName = content.slice(nameStart, j).toLowerCase()
    const attributes = new Map<string, string>()

    while (j < content.length) {
      while (j < content.length && /[\s/]/.test(content[j])) j++
      if (j > offset) return {kind: 'tag'}

      if (j >= content.length) break

      if (content[j] === '>') {
        j++
        break
      }

      const attributeStart = j
      j++
      while (j < content.length && !ATTRIBUTE_NAME_END.test(content[j])) j++
      if (j > offset) return {kind: 'tag'}

      const name = content.slice(attributeStart, j).toLowerCase()
      let afterName = j

      while (afterName < content.length && /\s/.test(content[afterName])) {
        afterName++
      }

      if (content[afterName] !== '=') {
        if (!attributes.has(name)) attributes.set(name, '')

        continue
      }

      j = afterName + 1
      while (j < content.length && /\s/.test(content[j])) j++

      const quote = content[j] === '"' || content[j] === "'" ? content[j] : ''
      const valueStart = quote ? j + 1 : j
      let valueEnd = valueStart

      if (quote) {
        const end = content.indexOf(quote, valueStart)
        valueEnd = end === -1 ? content.length : end
        j = Math.min(valueEnd + 1, content.length)
      } else {
        while (
          valueEnd < content.length &&
          !UNQUOTED_VALUE_END.test(content[valueEnd])
        ) {
          valueEnd++
        }

        j = valueEnd
      }

      if (offset >= valueStart && offset < valueEnd) {
        return {kind: 'attribute', name, quote, valueStart, valueEnd}
      }

      if (j > offset) return {kind: 'tag'}

      if (!attributes.has(name)) {
        attributes.set(name, content.slice(valueStart, valueEnd))
      }
    }

    if (j > offset) return {kind: 'tag'}

    if (!closing && RAW_TEXT_ELEMENTS.has(tagName)) {
      const close = new RegExp(`</${tagName}(?=[\\s/>])`, 'gi')
      close.lastIndex = j
      const textEnd = close.exec(content)?.index ?? content.length

      if (offset < textEnd) {
        if (tagName === 'script') {
          return {
            kind: 'script',
            type: attributes.get('type') || '',
            textStart: j,
            textEnd
          }
        }

        return tagName === 'style'
          ? {kind: 'style', textStart: j}
          : {kind: 'text', rawTag: tagName}
      }

      i = textEnd
      continue
    }

    i = j
  }

  return {kind: 'text'}
}

const JAVASCRIPT_TYPES = new Set([
  '',
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript'
])

function scriptLanguage(type: string): 'script' | 'module' | 'json' | 'data' {
  const essence = type.split(';')[0].trim().toLowerCase()

  if (essence === 'module') return 'module'
  if (JAVASCRIPT_TYPES.has(essence)) return 'script'
  if (/^text\/javascript1\.[0-5]$/.test(essence)) return 'script'

  return essence === 'importmap' ||
    essence === 'speculationrules' ||
    /(?:^|[/+])json$/.test(essence)
    ? 'json'
    : 'data'
}

type JsSink =
  | 'string'
  | 'template'
  | 'regexp'
  | 'code'
  | 'line-comment'
  | 'block-comment'
  | 'unknown'

interface JsRange {
  sink: JsSink
  start: number
  end: number
}

let parsed: {script: string; module: boolean; ranges: JsRange[] | null} = {
  script: '',
  module: false,
  ranges: []
}

const TOKEN_SINKS: Record<string, JsSink> = {
  string: 'string',
  template: 'template',
  regexp: 'regexp',
  name: 'code'
}

// A placeholder is a valid identifier, so the authored script parses as it
// stands and the real token under the placeholder names its sink.
function jsRangesOf(script: string, module: boolean): JsRange[] | null {
  if (parsed.script === script && parsed.module === module) {
    return parsed.ranges
  }

  let ranges: JsRange[] | null = []

  try {
    const collected = ranges

    acorn.parse(script, {
      ecmaVersion: 'latest',
      sourceType: module ? 'module' : 'script',
      allowHashBang: true,
      onToken: (token) => {
        const sink = TOKEN_SINKS[token.type.label]

        if (sink) collected.push({sink, start: token.start, end: token.end})
      },
      onComment: (block, _text, start, end) => {
        collected.push({
          sink: block ? 'block-comment' : 'line-comment',
          start,
          end
        })
      }
    })
  } catch {
    ranges = null
  }

  parsed = {script, module, ranges}

  return ranges
}

function jsSinkAt(script: string, at: number, module: boolean): JsSink {
  const ranges = jsRangesOf(script, module)

  return (
    ranges?.find((range) => at >= range.start && at < range.end)?.sink ||
    'unknown'
  )
}

// Every character that ends a line comment, the two Unicode separators included.
const LINE_TERMINATORS = new RegExp(
  `[\\r\\n${String.fromCharCode(0x2028, 0x2029)}]`,
  'g'
)

// The authored text on each side of a placeholder, as far as the longest
// terminator a value could finish or start.
interface Neighbors {
  left: string
  right: string
}

const NEIGHBOR_REACH = 16
const PLACEHOLDER_AT = /\$EXTENSION_[A-Z0-9_]+/y

function neighborsOf(
  content: string,
  offset: number,
  from = 0,
  to = content.length
): Neighbors {
  PLACEHOLDER_AT.lastIndex = offset
  const end = offset + (PLACEHOLDER_AT.exec(content)?.[0].length ?? 0)

  return {
    left: content.slice(Math.max(from, offset - NEIGHBOR_REACH), offset),
    right: content.slice(end, Math.min(to, end + NEIGHBOR_REACH))
  }
}

// A terminator can be spelled by the value alone or by the value joined to
// the authored text beside it. Each seam is a spot in the body inside one.
function seamsOf(
  {left, right}: Neighbors,
  body: string,
  terminators: RegExp
): number[] {
  const joined = left + body + right
  const pattern = new RegExp(terminators.source, 'gi')
  const seams = new Set<number>()

  for (
    let match = pattern.exec(joined);
    match !== null;
    match = pattern.exec(joined)
  ) {
    const at = Math.max(match.index + 1, left.length)

    if (at < match.index + match[0].length && at <= left.length + body.length) {
      seams.add(at - left.length)
    }

    pattern.lastIndex = match.index + 1
  }

  return [...seams].sort((a, b) => a - b)
}

// For a sink with no escape of its own, such as a comment: the terminator is
// split by a character that means nothing there.
function splitAtSeams(
  neighbors: Neighbors,
  body: string,
  terminators: RegExp,
  filler: string
): string {
  let out = ''
  let from = 0

  for (const seam of seamsOf(neighbors, body, terminators)) {
    out += body.slice(from, seam) + filler
    from = seam
  }

  return out + body.slice(from)
}

// For a sink with an escape: one character of the terminator is written in
// its escaped form, which reads the same and no longer spells it.
function escapeAtSeams(
  neighbors: Neighbors,
  body: string,
  terminators: RegExp,
  escapeChar: (char: string) => string
): string {
  const seams = new Set(
    seamsOf(neighbors, body, terminators).map((seam) =>
      Math.min(seam, body.length - 1)
    )
  )

  return body
    .split('')
    .map((char, index) => (seams.has(index) ? escapeChar(char) : char))
    .join('')
}

// An authored backslash right before the placeholder takes the first
// character that follows for itself, the closing quote included.
const followsBackslash = ({left}: Neighbors) =>
  /(?:^|[^\\])(?:\\\\)*\\$/.test(left)

const SCRIPT_ENDS = /<\/script|<!--/
const SCRIPT_OR_COMMENT_ENDS = /\*\/|<\/script|<!--/
const BACKSLASH = String.fromCharCode(0x5c)
const LINE_FEED = String.fromCharCode(0x0a)

const unicodeEscape = (char: string) =>
  `${BACKSLASH}u${char.charCodeAt(0).toString(16).padStart(4, '0')}`

const jsStringBody = (value: string) => toJsStringLiteral(value).slice(1, -1)

// A backslash and a line feed inside a quote stand for nothing, so they
// use up an authored backslash or split a terminator around an empty value.
function insideJsQuote(body: string, neighbors: Neighbors): string {
  if (followsBackslash(neighbors)) return LINE_FEED + body

  if (body === '' && seamsOf(neighbors, body, SCRIPT_ENDS).length > 0) {
    return BACKSLASH + LINE_FEED
  }

  return escapeAtSeams(neighbors, body, SCRIPT_ENDS, unicodeEscape)
}

type Escape = (value: string, neighbors: Neighbors) => string

const JS_ESCAPES_BY_SINK: Record<JsSink, Escape> = {
  string: (value, neighbors) =>
    insideJsQuote(jsStringBody(value).replace(/'/g, unicodeEscape), neighbors),
  template: (value, neighbors) =>
    insideJsQuote(
      jsStringBody(value).replace(/[`$]/g, unicodeEscape),
      neighbors
    ),
  // The value is matched as literal text, the reading a string value has.
  regexp: (value, neighbors) =>
    (followsBackslash(neighbors) ? 'x5c' : '') +
    escapeAtSeams(
      neighbors,
      value.replace(/[^A-Za-z0-9_ ]/g, unicodeEscape),
      SCRIPT_ENDS,
      unicodeEscape
    ),
  // The value is code, so it only loses the power to close the element.
  code: (value, neighbors) =>
    splitAtSeams(neighbors, value, SCRIPT_ENDS, BACKSLASH),
  'line-comment': (value, neighbors) =>
    splitAtSeams(
      neighbors,
      value.replace(LINE_TERMINATORS, ' '),
      SCRIPT_ENDS,
      ' '
    ),
  'block-comment': (value, neighbors) =>
    splitAtSeams(neighbors, value, SCRIPT_OR_COMMENT_ENDS, ' '),
  // No parse, so the one body that is inert in every quote and in a comment.
  unknown: (value, neighbors) =>
    (followsBackslash(neighbors) ? 'x5c' : '') +
    escapeAtSeams(
      neighbors,
      jsStringBody(value).replace(/['`$/]/g, unicodeEscape),
      SCRIPT_OR_COMMENT_ENDS,
      unicodeEscape
    )
}

const cssEscape = (char: string) =>
  `${BACKSLASH}${char.codePointAt(0)?.toString(16)} `

type CssSink = 'string' | 'url' | 'comment' | 'code'

// CSS has no token that depends on what came before it, so a plain walk over
// comments, strings and unquoted url() is exact.
function cssSinkAt(css: string): CssSink {
  let i = 0

  while (i < css.length) {
    const char = css[i]

    if (char === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      if (end === -1) return 'comment'

      i = end + 2
    } else if (char === '"' || char === "'") {
      i++

      while (i < css.length && css[i] !== char && !/[\n\r\f]/.test(css[i])) {
        i += css[i] === '\\' ? 2 : 1
      }

      if (i >= css.length) return 'string'

      i++
    } else if (char === '\\') {
      i += 2
    } else if (
      /^url\($/i.test(css.slice(i, i + 4)) &&
      !/[\w-]/.test(css[i - 1] || '')
    ) {
      i += 4
      while (i < css.length && /\s/.test(css[i])) i++

      if (css[i] === '"' || css[i] === "'") continue

      const end = css.indexOf(')', i)
      if (end === -1) return 'url'

      i = end + 1
    } else {
      i++
    }
  }

  return 'code'
}

const STYLE_END = /<\/style/
const STYLE_OR_COMMENT_ENDS = /\*\/|<\/style/

const CSS_ESCAPES_BY_SINK: Record<CssSink, Escape> = {
  // A backslash and a line feed stand for nothing in a CSS string as well.
  string: (value, neighbors) => {
    const body = value.replace(/[\\"'<\u0000-\u001f\u007f]/g, cssEscape)

    if (followsBackslash(neighbors)) return LINE_FEED + body

    if (body === '' && seamsOf(neighbors, body, STYLE_END).length > 0) {
      return BACKSLASH + LINE_FEED
    }

    return escapeAtSeams(neighbors, body, STYLE_END, cssEscape)
  },
  url: (value, neighbors) =>
    (followsBackslash(neighbors) ? '5c ' : '') +
    escapeAtSeams(
      neighbors,
      value.replace(/[\\"'()<\s\u0000-\u001f\u007f]/g, cssEscape),
      STYLE_END,
      cssEscape
    ),
  comment: (value, neighbors) =>
    splitAtSeams(neighbors, value, STYLE_OR_COMMENT_ENDS, ' '),
  // The value is CSS, so it only loses the power to close the element.
  code: (value, neighbors) =>
    splitAtSeams(neighbors, value, STYLE_END, BACKSLASH)
}

const escapeForCss = (cssBefore: string, value: string, neighbors: Neighbors) =>
  CSS_ESCAPES_BY_SINK[cssSinkAt(cssBefore)](value, neighbors)

function escapeForScript(
  content: string,
  offset: number,
  sink: Extract<HtmlSink, {kind: 'script'}>,
  value: string
): string {
  const language = scriptLanguage(sink.type)
  const neighbors = neighborsOf(content, offset, sink.textStart, sink.textEnd)

  // A data block of an unknown language is read as markup, the usual
  // template case, and entities also keep the value from closing the tag.
  if (language === 'data') {
    return escapeAtSeams(
      neighbors,
      toEntities(value),
      SCRIPT_ENDS,
      numericEntity
    )
  }

  if (language === 'json') {
    // Valid JSON holds a < only inside a string, so the escape is exact there.
    return escapeAtSeams(
      neighbors,
      isInsideJsonString(content.slice(sink.textStart), offset - sink.textStart)
        ? jsStringBody(value)
        : value.replace(/</g, unicodeEscape),
      SCRIPT_ENDS,
      unicodeEscape
    )
  }

  const script = content.slice(sink.textStart, sink.textEnd)

  return JS_ESCAPES_BY_SINK[
    jsSinkAt(script, offset - sink.textStart, language === 'module')
  ](value, neighbors)
}

function escapeForAttribute(
  content: string,
  offset: number,
  sink: Extract<HtmlSink, {kind: 'attribute'}>,
  value: string
): string {
  const neighbors = neighborsOf(content, offset, sink.valueStart, sink.valueEnd)
  let body = value

  // An event handler and a style attribute hold a second language, so the
  // value is made inert there before the attribute's own entities.
  if (/^on[a-z]/.test(sink.name)) {
    body = JS_ESCAPES_BY_SINK.unknown(value, neighbors)
  } else if (sink.name === 'style') {
    body = escapeForCss(
      content.slice(sink.valueStart, offset),
      value,
      neighbors
    )
  }

  if (sink.quote) return toEntities(body)

  const whole = content.slice(sink.valueStart, sink.valueEnd)

  // An empty value with no quotes would hand the attribute the next one.
  if (body === '' && /^\$EXTENSION_[A-Z0-9_]+$/.test(whole)) return '""'

  // Without quotes a space ends the value and = or ` is a parse error.
  return toEntities(body).replace(/[\s=`]/g, numericEntity)
}

const TAG_START = /<[a-z!?/]/

function escapeForText(
  value: string,
  neighbors: Neighbors,
  rawTag?: string
): string {
  let body = toEntities(value)

  // An authored & would read the start of the value as its own reference.
  if (/&#?[a-z0-9]*$/i.test(neighbors.left) && /^[a-z0-9#;]/i.test(body)) {
    body = numericEntity(body[0]) + body.slice(1)
  }

  // An authored < would read it as a tag name, or as the element's end.
  return escapeAtSeams(
    neighbors,
    body,
    rawTag ? new RegExp(`</${rawTag}`) : TAG_START,
    numericEntity
  )
}

// Every sink gets the escape that keeps the value's authored meaning there.
// Markup takes entities, a script or style takes the escape of its own token.
export function escapeForHtmlAsset(
  content: string,
  offset: number,
  value: string
): string {
  const sink = htmlSinkAt(content, offset)

  switch (sink.kind) {
    case 'script':
      return escapeForScript(content, offset, sink, value)
    case 'style':
      return escapeForCss(
        content.slice(sink.textStart, offset),
        value,
        neighborsOf(content, offset, sink.textStart)
      )
    case 'attribute':
      return escapeForAttribute(content, offset, sink, value)
    case 'comment':
      // Entities are not decoded in a comment. With no raw - ! or > left,
      // the value cannot spell its end, alone or with the text beside it.
      return toEntities(value).replace(/[-!]/g, numericEntity)
    case 'text':
      return escapeForText(value, neighborsOf(content, offset), sink.rawTag)
    default:
      return toEntities(value)
  }
}
