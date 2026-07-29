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

// Closed on purpose: an unknown value means pretty, so a typo can never
// silently swallow the human output a terminal user is reading.
const MACHINE_OUTPUT_VALUES = new Set(['json', 'ndjson'])

// True when stdout belongs to a machine (EXTENSION_OUTPUT is json or ndjson):
// frames own the streams and the human sinks below go quiet.
export function isMachineOutput(): boolean {
  return MACHINE_OUTPUT_VALUES.has(
    String(process.env.EXTENSION_OUTPUT || '')
      .trim()
      .toLowerCase()
  )
}

export function humanLine(...parts: unknown[]): void {
  if (isMachineOutput()) return
  console.log(...parts)
}

export function humanWarn(...parts: unknown[]): void {
  if (isMachineOutput()) return
  console.warn(...parts)
}

// Never suppressed: failures must stay visible in machine mode, and
// console.error targets stderr, so the stdout frame stream stays clean.
export function humanError(...parts: unknown[]): void {
  console.error(...parts)
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

// The card's Browser row has one spelling across every command: the browser
// name title-cased, followed by its version whenever the caller knows it.
export function browserRowValue(browser: string, versionLine?: string): string {
  const name = String(browser || '').trim() || 'unknown'
  const display = name.charAt(0).toUpperCase() + name.slice(1)
  const line = String(versionLine || '').trim()
  if (!line) return display
  // A bare version number carries no browser name, so it needs the prefix.
  if (!/[a-zA-Z]/.test(line)) return `${display} ${line}`
  return line.charAt(0).toUpperCase() + line.slice(1)
}

// One identity card per (browser, dist) pair per process. The registry rides
// on the environment because the CLI and develop bundles cannot share modules.
const CARD_KEYS_ENV = 'EXTENSION_CLI_CARD_KEYS'
const CARD_KEYS_SEPARATOR = '\u001f'

export function isCardKeyClaimed(key: string): boolean {
  const claimed = String(process.env[CARD_KEYS_ENV] || '')
  if (!claimed) return false
  return claimed.split(CARD_KEYS_SEPARATOR).includes(key)
}

export function claimCardKey(key: string): boolean {
  if (isCardKeyClaimed(key)) return false
  const claimed = String(process.env[CARD_KEYS_ENV] || '')
  process.env[CARD_KEYS_ENV] = claimed
    ? `${claimed}${CARD_KEYS_SEPARATOR}${key}`
    : key
  return true
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
  E_INTERNAL: 'E_INTERNAL',
  E_UNSUPPORTED_BROWSER: 'E_UNSUPPORTED_BROWSER',
  E_INVALID_OPTION: 'E_INVALID_OPTION',
  E_PORT_UNAVAILABLE: 'E_PORT_UNAVAILABLE',
  E_DEPENDENCY_INSTALL: 'E_DEPENDENCY_INSTALL',
  E_TEMPLATE_NOT_FOUND: 'E_TEMPLATE_NOT_FOUND',
  E_DESTINATION_NOT_EMPTY: 'E_DESTINATION_NOT_EMPTY',
  E_DESTINATION_NOT_WRITABLE: 'E_DESTINATION_NOT_WRITABLE',
  E_BROWSER_DOWNLOAD: 'E_BROWSER_DOWNLOAD',
  E_SESSION_NOT_FOUND: 'E_SESSION_NOT_FOUND',
  E_EVAL_REFUSED: 'E_EVAL_REFUSED',
  E_TARGET_NOT_FOUND: 'E_TARGET_NOT_FOUND',
  E_HEADED_WINDOW_REQUIRED: 'E_HEADED_WINDOW_REQUIRED',
  E_USER_GESTURE_REQUIRED: 'E_USER_GESTURE_REQUIRED',
  E_TIMEOUT: 'E_TIMEOUT',
  E_PUBLISH_REJECTED: 'E_PUBLISH_REJECTED',
  E_AUTH_REQUIRED: 'E_AUTH_REQUIRED',
  E_SAFARI_TOOLCHAIN: 'E_SAFARI_TOOLCHAIN',
  // Distinct from E_INTERNAL: these are exceptions thrown by the page or the
  // extension under test, not faults in the CLI itself.
  E_EVAL: 'E_EVAL',
  E_INSPECT: 'E_INSPECT',
  E_STORAGE: 'E_STORAGE',
  E_LOGS_NOT_FOUND: 'E_LOGS_NOT_FOUND',
  // The ready contract itself reports a failed session. Usually a compile
  // error, so it must not collapse into E_INTERNAL.
  E_READY_ERROR_STATUS: 'E_READY_ERROR_STATUS',
  E_COMMAND_UNSUPPORTED_FOR_TARGET: 'E_COMMAND_UNSUPPORTED_FOR_TARGET',
  E_FLAG_VALUE_INVALID: 'E_FLAG_VALUE_INVALID',
  E_FLAG_NOT_SUPPORTED_HERE: 'E_FLAG_NOT_SUPPORTED_HERE',
  E_DEV_SERVER_START: 'E_DEV_SERVER_START',
  E_DOCTOR_CHECKS_FAILED: 'E_DOCTOR_CHECKS_FAILED',
  E_TELEMETRY_WRITE: 'E_TELEMETRY_WRITE',
  E_PREVIEW_NO_DIST: 'E_PREVIEW_NO_DIST',
  E_BROWSER_UNINSTALL: 'E_BROWSER_UNINSTALL',
  // The rest of the inventoried union. One code per failure family; finer
  // legacy names fold onto these, see contract/codes.json for the mapping.
  E_NODE_VERSION: 'E_NODE_VERSION',
  E_UNKNOWN_COMMAND: 'E_UNKNOWN_COMMAND',
  E_REMOVED_FLAG: 'E_REMOVED_FLAG',
  E_BROWSER_NOT_INSTALLABLE: 'E_BROWSER_NOT_INSTALLABLE',
  E_PARENT_GONE: 'E_PARENT_GONE',
  E_REMOTE_URL_UNSUPPORTED: 'E_REMOTE_URL_UNSUPPORTED',
  E_CONFIG_LOAD: 'E_CONFIG_LOAD',
  E_MANAGED_DEP_CONFLICT: 'E_MANAGED_DEP_CONFLICT',
  E_TYPES_EMIT: 'E_TYPES_EMIT',
  E_TSCONFIG_MISSING: 'E_TSCONFIG_MISSING',
  E_OPTIONAL_DEP_UNRESOLVED: 'E_OPTIONAL_DEP_UNRESOLVED',
  E_OPTIONAL_DEP_LOAD: 'E_OPTIONAL_DEP_LOAD',
  E_OPTIONAL_DEP_UNKNOWN: 'E_OPTIONAL_DEP_UNKNOWN',
  E_COMPANION_EXTENSION_PATH: 'E_COMPANION_EXTENSION_PATH',
  E_MANIFEST_IN_PUBLIC: 'E_MANIFEST_IN_PUBLIC',
  E_RUNTIME_NOT_FOUND: 'E_RUNTIME_NOT_FOUND',
  E_MANIFEST_SHAPE: 'E_MANIFEST_SHAPE',
  E_MANIFEST_PAGE_MISSING: 'E_MANIFEST_PAGE_MISSING',
  E_MANIFEST_VERSION_UNSUPPORTED: 'E_MANIFEST_VERSION_UNSUPPORTED',
  E_MANIFEST_LOAD_BLOCKERS: 'E_MANIFEST_LOAD_BLOCKERS',
  E_MANIFEST_PERMISSION_MISSING: 'E_MANIFEST_PERMISSION_MISSING',
  E_MANIFEST_MSG_KEY_MISSING: 'E_MANIFEST_MSG_KEY_MISSING',
  E_MANIFEST_EMIT: 'E_MANIFEST_EMIT',
  E_RESTART_REQUIRED: 'E_RESTART_REQUIRED',
  E_COMPILE_FATAL: 'E_COMPILE_FATAL',
  E_MODULE_NOT_FOUND: 'E_MODULE_NOT_FOUND',
  E_ENTRY_NOT_FOUND: 'E_ENTRY_NOT_FOUND',
  E_ASSET_MISSING: 'E_ASSET_MISSING',
  E_SCRIPT_DEP_MISSING: 'E_SCRIPT_DEP_MISSING',
  E_RESERVED_FOLDER: 'E_RESERVED_FOLDER',
  E_CSS_PARSE: 'E_CSS_PARSE',
  E_CSS_PREPROCESSOR_MISSING: 'E_CSS_PREPROCESSOR_MISSING',
  E_CSS_DEAD_REF: 'E_CSS_DEAD_REF',
  E_INTEGRATION_INSTALL: 'E_INTEGRATION_INSTALL',
  E_POLYFILL_NOT_FOUND: 'E_POLYFILL_NOT_FOUND',
  E_LOCALES_LAYOUT: 'E_LOCALES_LAYOUT',
  E_WAR_INVALID: 'E_WAR_INVALID',
  E_MATCH_PATTERN_INVALID: 'E_MATCH_PATTERN_INVALID',
  E_BACKGROUND_REQUIRED: 'E_BACKGROUND_REQUIRED',
  E_CONTENT_SCRIPT_SYNTAX: 'E_CONTENT_SCRIPT_SYNTAX',
  E_NO_ENTRYPOINTS: 'E_NO_ENTRYPOINTS',
  E_REMOTE_RESOURCE_BLOCKED: 'E_REMOTE_RESOURCE_BLOCKED',
  E_PERF_BUDGET: 'E_PERF_BUDGET',
  E_ZIP_SKIPPED: 'E_ZIP_SKIPPED',
  E_ENV_NO_MATCH: 'E_ENV_NO_MATCH',
  E_REMOTE_FETCH_TIMEOUT: 'E_REMOTE_FETCH_TIMEOUT',
  E_REMOTE_DOWNLOAD: 'E_REMOTE_DOWNLOAD',
  E_REMOTE_ZIP_INVALID: 'E_REMOTE_ZIP_INVALID',
  E_LOCAL_ZIP_NOT_FOUND: 'E_LOCAL_ZIP_NOT_FOUND',
  E_PROJECT_DOWNLOAD_EMPTY: 'E_PROJECT_DOWNLOAD_EMPTY',
  E_BROWSER_BINARY_REQUIRED: 'E_BROWSER_BINARY_REQUIRED',
  E_BROWSER_BINARY_INVALID: 'E_BROWSER_BINARY_INVALID',
  E_BROWSER_EXITED: 'E_BROWSER_EXITED',
  E_BROWSER_START_TIMEOUT: 'E_BROWSER_START_TIMEOUT',
  E_LAUNCH_SKIPPED_COMPILE_ERRORS: 'E_LAUNCH_SKIPPED_COMPILE_ERRORS',
  E_INSTANCE_AMBIGUOUS: 'E_INSTANCE_AMBIGUOUS',
  E_WSL_INTEROP: 'E_WSL_INTEROP',
  E_EXTENSION_LOAD_REFUSED: 'E_EXTENSION_LOAD_REFUSED',
  E_ADDON_INSTALL: 'E_ADDON_INSTALL',
  E_BROWSER_CONNECT: 'E_BROWSER_CONNECT',
  E_BROWSER_CONNECTION_CLOSED: 'E_BROWSER_CONNECTION_CLOSED',
  E_CDP_NOT_CONNECTED: 'E_CDP_NOT_CONNECTED',
  E_CDP_TIMEOUT: 'E_CDP_TIMEOUT',
  E_CDP_OP_FAILED: 'E_CDP_OP_FAILED',
  E_EXTENSION_ID_UNKNOWN: 'E_EXTENSION_ID_UNKNOWN',
  E_RDP_PROTOCOL: 'E_RDP_PROTOCOL',
  E_DEV_SERVER_TIMEOUT: 'E_DEV_SERVER_TIMEOUT',
  E_PORT_IN_USE: 'E_PORT_IN_USE',
  E_SESSION_STOPPED: 'E_SESSION_STOPPED',
  E_LOGS_STREAM_GAP: 'E_LOGS_STREAM_GAP',
  E_CREATE_DIR: 'E_CREATE_DIR',
  E_CREATE_WRITE: 'E_CREATE_WRITE',
  E_CREATE_TESTS_SETUP: 'E_CREATE_TESTS_SETUP',
  E_GIT_SKIPPED: 'E_GIT_SKIPPED',
  E_BROWSER_INSTALL_PRIVILEGE: 'E_BROWSER_INSTALL_PRIVILEGE',
  E_UNINSTALL_NOOP: 'E_UNINSTALL_NOOP'
} as const

export type ErrorCode = (typeof CODES)[keyof typeof CODES]

// The actionable parts a message or hint names, carried beside the sentence so
// a consumer can render its own copy instead of rewriting the engine's.
export interface EnvelopeErrorRefs {
  flag?: string
  command?: string
  path?: string
  version?: string
}

// name and engine exist so the act frame stays a subset of this shape: the MCP
// reads frame.error.message and frame.error.hint today and must keep working.
export interface EnvelopeError {
  code: ErrorCode
  message: string
  name?: string
  engine?: string
  hint?: string
  refs?: EnvelopeErrorRefs
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
  // A failure can still carry a payload. `doctor` is the motivating case: the
  // check list IS the diagnosis, and is most useful exactly when ok is false.
  value?: unknown
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
  ): Envelope {
    return withExtras(
      {
        schema: ENVELOPE_SCHEMA,
        ok: false,
        command,
        status,
        value: extras.value ?? null,
        error,
        warnings: []
      },
      extras
    )
  }
}
