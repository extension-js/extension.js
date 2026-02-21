// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

export type SourceFormat = 'pretty' | 'json' | 'ndjson'
export type SourceRedact = 'off' | 'safe' | 'strict'
export type SourceIncludeShadow = 'off' | 'open-only' | 'all'
export type SourceStage = 'pre_injection' | 'post_injection' | 'updated'

export type SourceOutputMeta = {
  stage: SourceStage
  browser?: string
  mode?: string
  url?: string
  title?: string
  tabId?: number | string
}

export type SourceSummary = {
  counts: {
    extensionRoots: number
    shadowRoots: number
    scripts: number
    styles: number
  }
  markers: {
    hasExtensionRootId: boolean
    hasContentScriptMarker: boolean
  }
  snippet?: string
}

export type DomSnapshotNode = {
  key: string
  tag: string
  id?: string
  classes?: string
  role?: string
  ariaLabel?: string
  name?: string
  type?: string
  textLength?: number
  childCount?: number
}

export type DomSnapshot = {
  rootMode: 'shadow' | 'element'
  depthLimit: number
  nodeLimit: number
  truncated: boolean
  nodes: DomSnapshotNode[]
}

export type NormalizedSourceOutputConfig = {
  format: SourceFormat
  summary: boolean
  maxBytes: number
  redact: SourceRedact
  includeShadow: SourceIncludeShadow
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | undefined {
  if (typeof value === 'undefined' || value === null) return undefined

  const normalized = String(value).trim().toLowerCase()

  if (!normalized) return undefined

  return (allowed as readonly string[]).includes(normalized)
    ? (normalized as T)
    : undefined
}

function resolveEnvMaxBytes(): number | undefined {
  const raw = String(process.env.EXTENSION_SOURCE_MAX_BYTES || '').trim()

  if (!raw) return undefined
  if (!/^\d+$/.test(raw)) return undefined

  return Math.max(0, parseInt(raw, 10))
}

function isRawEnvEnabled(): boolean {
  const raw = String(process.env.EXTENSION_SOURCE_RAW || '').trim()
  return raw === '1' || raw.toLowerCase() === 'true'
}

export function normalizeSourceOutputConfig(input: {
  format?: string
  summary?: boolean
  maxBytes?: number
  redact?: string
  includeShadow?: string
  sourceEnabled?: boolean
  logFormat?: string
}): NormalizedSourceOutputConfig {
  const allowedFormats = ['pretty', 'json', 'ndjson'] as const
  const allowedRedact = ['off', 'safe', 'strict'] as const
  const allowedShadow = ['off', 'open-only', 'all'] as const

  const format =
    normalizeEnum(input.format, allowedFormats) ||
    normalizeEnum(input.logFormat, allowedFormats) ||
    (input.sourceEnabled ? 'json' : 'pretty')

  const summary = Boolean(input.summary)

  let maxBytes =
    typeof input.maxBytes === 'number' && Number.isFinite(input.maxBytes)
      ? Math.max(0, Math.floor(input.maxBytes))
      : undefined

  if (typeof maxBytes === 'undefined') {
    const envMax = resolveEnvMaxBytes()
    if (typeof envMax === 'number') maxBytes = envMax
  }

  if (typeof maxBytes === 'undefined') {
    maxBytes = 262144
  }

  if (isRawEnvEnabled() && typeof input.maxBytes === 'undefined') {
    maxBytes = 0
  }

  let redact =
    normalizeEnum(input.redact, allowedRedact) ||
    (format !== 'pretty' ? 'safe' : 'off')

  if (isRawEnvEnabled() && typeof input.redact === 'undefined') {
    redact = 'off'
  }

  const includeShadow =
    normalizeEnum(input.includeShadow, allowedShadow) ||
    (input.sourceEnabled ? 'open-only' : 'off')

  return {
    format,
    summary,
    maxBytes,
    redact,
    includeShadow
  }
}

export function applySourceRedaction(
  html: string,
  redact: SourceRedact
): string {
  if (!html) return ''
  if (redact === 'off') return html

  let output = html

  output = stripTagBlocks(output, 'script')
  output = stripTagBlocks(output, 'style')
  output = output.replace(/data:[^"'\s>]{1024,}/gi, 'data:[REDACTED_BASE64]')

  if (redact === 'strict') {
    output = stripInlineEventHandlers(output)
    output = output.replace(/="[^"]{257,}"/g, (match) => {
      return `="${match.slice(2, 258)}..."`
    })
    output = output.replace(/='[^']{257,}'/g, (match) => {
      return `='${match.slice(2, 258)}...'`
    })
    output = output.replace(/\b(?:javascript|data|vbscript)\s*:/gi, '')
  }

  return output
}

function stripTagBlocks(input: string, tagName: 'script' | 'style'): string {
  const lower = input.toLowerCase()
  const openToken = `<${tagName}`
  const closeToken = `</${tagName}`

  let cursor = 0
  let output = ''

  while (cursor < input.length) {
    const openIndex = lower.indexOf(openToken, cursor)
    if (openIndex === -1) {
      output += input.slice(cursor)
      break
    }

    output += input.slice(cursor, openIndex)
    const openEnd = lower.indexOf('>', openIndex + openToken.length)
    if (openEnd === -1) break

    const closeIndex = lower.indexOf(closeToken, openEnd + 1)
    if (closeIndex === -1) {
      cursor = openEnd + 1
      continue
    }

    const closeEnd = lower.indexOf('>', closeIndex + closeToken.length)
    cursor = closeEnd === -1 ? closeIndex + closeToken.length : closeEnd + 1
  }

  return output
}

function stripInlineEventHandlers(input: string): string {
  let output = ''
  let cursor = 0

  while (cursor < input.length) {
    const tagStart = input.indexOf('<', cursor)
    if (tagStart === -1) {
      output += input.slice(cursor)
      break
    }

    output += input.slice(cursor, tagStart)
    const tagEnd = input.indexOf('>', tagStart + 1)
    if (tagEnd === -1) {
      output += input.slice(tagStart)
      break
    }

    const tag = input.slice(tagStart, tagEnd + 1)
    output += stripInlineEventHandlersFromTag(tag)
    cursor = tagEnd + 1
  }

  return output
}

function stripInlineEventHandlersFromTag(tag: string): string {
  if (tag.startsWith('</') || tag.startsWith('<!') || tag.startsWith('<?')) {
    return tag
  }

  const withoutClose = tag.endsWith('/>') ? tag.slice(0, -2) : tag.slice(0, -1)
  const closeSuffix = tag.endsWith('/>') ? '/>' : '>'
  const firstSpace = withoutClose.search(/\s/)
  if (firstSpace === -1) return tag

  const prefix = withoutClose.slice(0, firstSpace)
  const attrs = withoutClose.slice(firstSpace)
  let rebuilt = prefix
  let i = 0

  while (i < attrs.length) {
    while (i < attrs.length && /\s/.test(attrs[i])) i += 1
    if (i >= attrs.length) break

    const attrStart = i
    while (i < attrs.length && !/[\s=>]/.test(attrs[i])) i += 1
    const attrName = attrs.slice(attrStart, i)
    const attrNameLower = attrName.toLowerCase()

    while (i < attrs.length && /\s/.test(attrs[i])) i += 1
    let value = ''

    if (attrs[i] === '=') {
      value += '='
      i += 1
      while (i < attrs.length && /\s/.test(attrs[i])) {
        value += attrs[i]
        i += 1
      }

      const quote = attrs[i]
      if (quote === '"' || quote === "'") {
        value += quote
        i += 1
        while (i < attrs.length && attrs[i] !== quote) {
          value += attrs[i]
          i += 1
        }
        if (i < attrs.length && attrs[i] === quote) {
          value += attrs[i]
          i += 1
        }
      } else {
        while (i < attrs.length && !/[\s>]/.test(attrs[i])) {
          value += attrs[i]
          i += 1
        }
      }
    }

    if (!attrNameLower.startsWith('on')) {
      rebuilt += ` ${attrName}${value}`
    }
  }

  return `${rebuilt}${closeSuffix}`
}

export function truncateByBytes(
  input: string,
  maxBytes: number
): {
  output: string
  truncated: boolean
  byteLength: number
} {
  const html = input || ''
  const byteLength = Buffer.byteLength(html, 'utf8')

  if (maxBytes <= 0 || byteLength <= maxBytes) {
    return {output: html, truncated: false, byteLength}
  }

  let acc = 0
  let endIndex = 0

  for (let i = 0; i < html.length; i++) {
    const b = Buffer.byteLength(html[i], 'utf8')
    if (acc + b > maxBytes) break
    acc += b
    endIndex = i + 1
  }

  return {output: html.slice(0, endIndex), truncated: true, byteLength}
}

export function hashStringFNV1a(input: string): string {
  let hash = 0x811c9dc5

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }

  return hash.toString(16).padStart(8, '0')
}

export function diffDomSnapshots(
  prev: DomSnapshot | undefined,
  next: DomSnapshot
): {
  added: number
  removed: number
  changed: number
  addedKeys: string[]
  removedKeys: string[]
  changedKeys: string[]
} {
  if (!prev) {
    return {
      added: next.nodes.length,
      removed: 0,
      changed: 0,
      addedKeys: next.nodes.slice(0, 50).map((n) => n.key),
      removedKeys: [],
      changedKeys: []
    }
  }

  const prevMap = new Map(prev.nodes.map((n) => [n.key, n]))
  const nextMap = new Map(next.nodes.map((n) => [n.key, n]))

  let added = 0
  let removed = 0
  let changed = 0
  const addedKeys: string[] = []
  const removedKeys: string[] = []
  const changedKeys: string[] = []

  for (const [key, node] of nextMap.entries()) {
    if (!prevMap.has(key)) {
      added += 1
      if (addedKeys.length < 50) addedKeys.push(key)
      continue
    }

    const prevNode = prevMap.get(key)!
    const prevHash = hashStringFNV1a(JSON.stringify(prevNode))
    const nextHash = hashStringFNV1a(JSON.stringify(node))

    if (prevHash !== nextHash) {
      changed += 1
      if (changedKeys.length < 50) changedKeys.push(key)
    }
  }

  for (const key of prevMap.keys()) {
    if (!nextMap.has(key)) {
      removed += 1
      if (removedKeys.length < 50) removedKeys.push(key)
    }
  }

  return {added, removed, changed, addedKeys, removedKeys, changedKeys}
}

export function resolveActionFormat(): SourceFormat {
  const raw = String(process.env.EXTENSION_SOURCE_FORMAT || '').trim()
  if (raw === 'json' || raw === 'ndjson') return raw

  return 'json'
}

function isActionEventOutputEnabled(): boolean {
  const authorMode = String(process.env.EXTENSION_AUTHOR_MODE || '')
    .trim()
    .toLowerCase()

  return authorMode === 'true' || authorMode === 'development'
}

export function emitActionEvent(
  action: string,
  payload: Record<string, unknown> = {},
  _format: SourceFormat = resolveActionFormat()
) {
  if (!isActionEventOutputEnabled()) return

  const eventDate = new Date()
  const base = {
    type: 'action_event',
    schema_version: '1.0',
    timestamp: eventDate.toISOString(),
    action,
    ...payload
  }

  console.log(JSON.stringify(base))
}

export function buildHtmlSummary(html: string): SourceSummary {
  const content = html || ''
  const extensionRootIdMatches =
    content.match(/id=(["'])extension-root\1/gi) || []
  const extensionRootDataMatches =
    content.match(/data-extension-root=(["'])true\1/gi) || []
  const shadowRootMatches = content.match(/shadowroot=/gi) || []
  const scripts = content.match(/<script\b/gi) || []
  const styles = content.match(/<style\b/gi) || []

  const hasExtensionRootId = extensionRootIdMatches.length > 0
  const hasContentScriptMarker =
    /(content_script|content_title|js-probe)/i.test(content)

  const markerIndex = content.search(
    /id=(["'])extension-root\1|data-extension-root=(["'])true\2/i
  )
  let snippet = ''

  if (markerIndex >= 0) {
    const start = Math.max(0, markerIndex - 200)
    const end = Math.min(content.length, markerIndex + 400)
    snippet = content.slice(start, end).replace(/\s+/g, ' ').trim()
  }

  return {
    counts: {
      extensionRoots:
        extensionRootIdMatches.length + extensionRootDataMatches.length,
      shadowRoots: shadowRootMatches.length,
      scripts: scripts.length,
      styles: styles.length
    },
    markers: {
      hasExtensionRootId,
      hasContentScriptMarker
    },
    snippet: snippet || undefined
  }
}

function sanitizeAttr(value?: string | number): string {
  if (typeof value === 'undefined' || value === null) return ''
  return String(value).replace(/"/g, "'").replace(/\s+/g, ' ').trim()
}

export function formatHtmlSentinelBegin(meta: {
  url?: string
  title?: string
  tabId?: number | string
  stage?: string
  truncated?: boolean
}): string {
  const parts = [
    meta.url ? `url="${sanitizeAttr(meta.url)}"` : '',
    meta.title ? `title="${sanitizeAttr(meta.title)}"` : '',
    typeof meta.tabId !== 'undefined'
      ? `tab="${sanitizeAttr(meta.tabId)}"`
      : '',
    meta.stage ? `stage="${sanitizeAttr(meta.stage)}"` : '',
    typeof meta.truncated !== 'undefined'
      ? `truncated="${sanitizeAttr(meta.truncated.toString())}"`
      : ''
  ].filter(Boolean)

  const suffix = parts.length > 0 ? ` ${parts.join(' ')}` : ''

  return `<<<EXTJS_HTML_BEGIN${suffix}>>>`
}

export function formatHtmlSentinelEnd(): string {
  return '<<<EXTJS_HTML_END>>>'
}
