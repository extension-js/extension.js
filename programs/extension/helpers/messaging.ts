// ███╗   ███╗███████╗███████╗███████╗ █████╗  ██████╗ ██╗███╗   ██╗ ██████╗
// ████╗ ████║██╔════╝██╔════╝██╔════╝██╔══██╗██╔════╝ ██║████╗  ██║██╔════╝
// ██╔████╔██║█████╗  ███████╗███████╗███████║██║  ███╗██║██╔██╗ ██║██║  ███╗
// ██║╚██╔╝██║██╔══╝  ╚════██║╚════██║██╔══██║██║   ██║██║██║╚██╗██║██║   ██║
// ██║ ╚═╝ ██║███████╗███████║███████║██║  ██║╚██████╔╝██║██║ ╚████║╚██████╔╝
// ╚═╝     ╚═╝╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝╚═╝  ╚═══╝ ╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Messaging primitives shared by every program, duplicated on purpose.
// Canonical copy: programs/develop/lib/messaging.ts. Edit that one, then copy
// it over the other three. A drift spec fails the build when they diverge.
// Do not add imports here beyond pintor; three of the four consumers are
// small packages that must not inherit a dependency graph from this file.

import colors from 'pintor'

export type Channel = 'info' | 'success' | 'warn' | 'error' | 'debug'

const GLYPH = '⏵⏵⏵'
const DEBUG_GLYPH = '···'

// Closed on purpose: specs set 'false' and 'test' and expect diagnostics off,
// so an "any non-empty value" reading would silently turn them on.
const DEBUG_VALUES = new Set([
  '1',
  'true',
  'yes',
  'on',
  'debug',
  'dev',
  'development'
])

// EXTENSION_DEBUG wins over the legacy name so an explicit EXTENSION_DEBUG=0
// still turns diagnostics off when a stale EXTENSION_AUTHOR_MODE is exported.
export function isDebug(): boolean {
  const raw = process.env.EXTENSION_DEBUG ?? process.env.EXTENSION_AUTHOR_MODE
  return DEBUG_VALUES.has(
    String(raw ?? '')
      .trim()
      .toLowerCase()
  )
}

export function prefix(type: Channel): string {
  if (type === 'error') return colors.red(GLYPH)
  if (type === 'warn') return colors.brightYellow(GLYPH)
  if (type === 'success') return colors.green(GLYPH)
  if (type === 'debug') return colors.dim(colors.gray(DEBUG_GLYPH))
  return colors.gray(GLYPH)
}

export const fmt = {
  heading: (title: string) => colors.underline(colors.blue(title)),
  label: (key: string) => colors.gray(key.toUpperCase()),
  val: (value: string) => colors.underline(value),
  code: (value: string) => colors.blue(value),
  bullet: (value: string) => `- ${value}`,
  block(title: string, rows: Array<[string, string]>): string {
    const head = fmt.heading(title)
    const body = rows
      .map(([key, value]) => `${fmt.label(key)} ${value}`)
      .join('\n')
    return `${head}\n${body}`
  },
  truncate(input: unknown, max = 800): string {
    const s = (() => {
      try {
        return typeof input === 'string' ? input : JSON.stringify(input)
      } catch {
        return String(input)
      }
    })()
    return s.length > max ? `${s.slice(0, max)}…` : s
  }
}

export interface CardRow {
  label: string
  value?: string
}

export interface CardInput {
  version?: string
  suffix?: string
  rows?: CardRow[]
}

const CARD_LABEL_WIDTH = 15

export function card(input: CardInput = {}): string {
  const version = String(input.version || '').trim()
  const suffix = String(input.suffix || '').trim()
  const head =
    ` 🧩 ${colors.brightBlue('Extension.js')}` +
    (version ? ` ${colors.gray(version)}` : '') +
    (suffix ? ` ${suffix}` : '')
  // Rows are omitted when the caller has no value, never rendered as 'n/a'.
  const body = (input.rows || [])
    .filter((row) => String(row.value || '').trim().length > 0)
    .map((row) => {
      const label = row.label.padEnd(CARD_LABEL_WIDTH)
      return `    ${label}${colors.gray(String(row.value).trim())}`
    })
  return [head, ...body].join('\n')
}

const GECKO_BROWSERS = new Set([
  'firefox',
  'firefox-based',
  'gecko-based',
  'librewolf',
  'waterfox'
])

export function artifactNoun(browser: string): 'Add-on' | 'Extension' {
  const name = String(browser || '')
    .trim()
    .toLowerCase()
  if (GECKO_BROWSERS.has(name)) return 'Add-on'
  // Unknown forks: a gecko/firefox substring is the only reliable signal.
  // Edge ships extensions through an Add-ons store, so it stays an Extension.
  if (name.includes('gecko') || name.includes('firefox')) return 'Add-on'
  return 'Extension'
}

export const ENVELOPE_SCHEMA = 1

// Stable identifiers for a failure class. The message beside them is free copy
// and may be rewritten at any time; the code is the part consumers match on.
export const CODES = {
  E_ARGS: 'E_ARGS',
  E_PROJECT_NOT_FOUND: 'E_PROJECT_NOT_FOUND',
  E_MANIFEST_NOT_FOUND: 'E_MANIFEST_NOT_FOUND',
  E_MANIFEST_INVALID: 'E_MANIFEST_INVALID',
  E_FIRST_COMPILE: 'E_FIRST_COMPILE',
  E_COMPILE: 'E_COMPILE',
  E_BROWSER_NOT_FOUND: 'E_BROWSER_NOT_FOUND',
  E_BROWSER_LAUNCH: 'E_BROWSER_LAUNCH',
  E_PROFILE_LOCKED: 'E_PROFILE_LOCKED',
  E_READY_TIMEOUT: 'E_READY_TIMEOUT',
  E_SESSION_EXISTS: 'E_SESSION_EXISTS',
  E_CONTROL_DENIED: 'E_CONTROL_DENIED',
  E_CONTROL_UNAVAILABLE: 'E_CONTROL_UNAVAILABLE',
  E_TOKEN_MISSING: 'E_TOKEN_MISSING',
  E_NETWORK: 'E_NETWORK',
  E_INTERRUPTED: 'E_INTERRUPTED',
  E_NOT_IMPLEMENTED: 'E_NOT_IMPLEMENTED',
  E_INTERNAL: 'E_INTERNAL'
} as const

export type ErrorCode = (typeof CODES)[keyof typeof CODES]

// name and engine exist so the act frame stays a subset of this shape: the MCP
// reads frame.error.message and frame.error.hint today and must keep working.
export interface EnvelopeError {
  code: ErrorCode
  message: string
  name?: string
  engine?: string
  hint?: string
}

export interface Envelope<T = unknown> {
  schema: typeof ENVELOPE_SCHEMA
  ok: boolean
  command: string
  status: string
  value: T | null
  error: EnvelopeError | null
  truncated?: boolean
  hint?: string
  warnings: string[]
}

export interface EnvelopeExtras {
  hint?: string
  warnings?: string[]
  truncated?: boolean
}

function withExtras<T>(base: Envelope<T>, extras: EnvelopeExtras): Envelope<T> {
  return {
    ...base,
    ...(extras.hint ? {hint: extras.hint} : {}),
    ...(extras.truncated ? {truncated: true} : {}),
    warnings: extras.warnings || []
  }
}

export const ENVELOPE = {
  schema: ENVELOPE_SCHEMA,
  ok<T>(
    command: string,
    status: string,
    value: T,
    extras: EnvelopeExtras = {}
  ): Envelope<T> {
    return withExtras(
      {
        schema: ENVELOPE_SCHEMA,
        ok: true,
        command,
        status,
        value,
        error: null,
        warnings: []
      },
      extras
    )
  },
  fail(
    command: string,
    status: string,
    error: EnvelopeError,
    extras: EnvelopeExtras = {}
  ): Envelope<null> {
    return withExtras(
      {
        schema: ENVELOPE_SCHEMA,
        ok: false,
        command,
        status,
        value: null,
        error,
        warnings: []
      },
      extras
    )
  }
}
