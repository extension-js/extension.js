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
  | {kind: 'text'}
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
          : {kind: 'text'}
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

const keepTagOpen = (value: string, tag: string) =>
  value
    .replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1')
    .replace(/<!--/g, '<\\!--')

const jsStringBody = (value: string) => toJsStringLiteral(value).slice(1, -1)

const JS_ESCAPES_BY_SINK: Record<JsSink, (value: string) => string> = {
  string: (value) => jsStringBody(value).replace(/'/g, '\\u0027'),
  template: (value) =>
    jsStringBody(value).replace(/`/g, '\\u0060').replace(/\$/g, '\\u0024'),
  // The value is matched as literal text, the reading a string value has.
  regexp: (value) =>
    value.replace(
      /[^A-Za-z0-9_ ]/g,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
    ),
  code: (value) => keepTagOpen(value, 'script'),
  'line-comment': (value) =>
    keepTagOpen(value, 'script').replace(LINE_TERMINATORS, ' '),
  'block-comment': (value) =>
    keepTagOpen(value, 'script').replace(/\*\//g, '*\\/'),
  // No parse, so the one body that is inert in every quote and in a comment.
  unknown: (value) =>
    jsStringBody(value)
      .replace(/'/g, '\\u0027')
      .replace(/`/g, '\\u0060')
      .replace(/\$/g, '\\u0024')
      .replace(/\//g, '\\/')
}

const cssEscape = (char: string) => `\\${char.codePointAt(0)?.toString(16)} `

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

const CSS_ESCAPES_BY_SINK: Record<CssSink, (value: string) => string> = {
  string: (value) => value.replace(/[\\"'<\u0000-\u001f\u007f]/g, cssEscape),
  url: (value) => value.replace(/[\\"'()<\s\u0000-\u001f\u007f]/g, cssEscape),
  comment: (value) =>
    value.replace(/\*\//g, '* /').replace(/<\/(style)/gi, '< /$1'),
  code: (value) => value.replace(/<\/(style)/gi, '<\\/$1')
}

const escapeForCss = (cssBefore: string, value: string) =>
  CSS_ESCAPES_BY_SINK[cssSinkAt(cssBefore)](value)

function escapeForScript(
  content: string,
  offset: number,
  sink: Extract<HtmlSink, {kind: 'script'}>,
  value: string
): string {
  const language = scriptLanguage(sink.type)

  // A data block of an unknown language is read as markup, the usual
  // template case, and entities also keep the value from closing the tag.
  if (language === 'data') return toEntities(value)

  if (language === 'json') {
    // Valid JSON holds a < only inside a string, so the escape is exact there.
    return isInsideJsonString(
      content.slice(sink.textStart),
      offset - sink.textStart
    )
      ? jsStringBody(value)
      : value.replace(/</g, '\\u003c')
  }

  const script = content.slice(sink.textStart, sink.textEnd)

  return JS_ESCAPES_BY_SINK[
    jsSinkAt(script, offset - sink.textStart, language === 'module')
  ](value)
}

function escapeForAttribute(
  content: string,
  offset: number,
  sink: Extract<HtmlSink, {kind: 'attribute'}>,
  value: string
): string {
  let body = value

  // An event handler and a style attribute hold a second language, so the
  // value is made inert there before the attribute's own entities.
  if (/^on[a-z]/.test(sink.name)) body = JS_ESCAPES_BY_SINK.unknown(value)
  else if (sink.name === 'style') {
    body = escapeForCss(content.slice(sink.valueStart, offset), value)
  }

  if (sink.quote) return toEntities(body)

  const whole = content.slice(sink.valueStart, sink.valueEnd)

  // An empty value with no quotes would hand the attribute the next one.
  if (body === '' && /^\$EXTENSION_[A-Z0-9_]+$/.test(whole)) return '""'

  // Without quotes a space ends the value and = or ` is a parse error.
  return toEntities(body).replace(/[\s=`]/g, numericEntity)
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
      return escapeForCss(content.slice(sink.textStart, offset), value)
    case 'attribute':
      return escapeForAttribute(content, offset, sink, value)
    case 'comment':
      // Entities are not decoded in a comment, they only keep it from closing.
      return toEntities(value).replace(/-(?=-)|^-|-$/g, numericEntity)
    default:
      return toEntities(value)
  }
}
