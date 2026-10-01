// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {logsPath} from '../../lib/session-paths'
import {LOG_CONTEXTS} from './contracts'

// The selection rules behind `extension logs`, published so a host does not
// have to re-derive level ordering, the glob dialect or the header rule from
// the CLI's observable behavior. `extension logs` and any programmatic reader
// must agree on what a filter selects, or the same query answers twice.

/** Increasing verbosity; a level selects itself plus everything more severe. */
export const LOG_LEVEL_ORDER = [
  'error',
  'warn',
  'info',
  'debug',
  'trace'
] as const

/** What a level filter may name: a level, every level, or none at all. */
export const LOG_LEVEL_FILTERS = ['off', ...LOG_LEVEL_ORDER, 'all'] as const

export type LogLevelFilter = (typeof LOG_LEVEL_FILTERS)[number] | (string & {})

export interface LogQuery {
  /** One context, a comma-separated list, an array, or 'all'. */
  context?: string | string[]
  /** Minimum severity. 'all' selects every level, 'off' selects none. */
  level?: LogLevelFilter
  /** Only structured dx.signal diagnostics. */
  signalsOnly?: boolean
  /** Only events after this point: a sequence number, or an ISO timestamp
   * compared against the event's own clock. */
  since?: number | string
  /** Glob (`*` = any run of chars) or plain substring over url then hostname. */
  url?: string
  /** Only events carrying this tab id. */
  tab?: number | string
}

/** A bridge log line as read off disk: dynamic, so the probed fields only. */
export interface LogEventLike {
  type?: unknown
  eventType?: unknown
  context?: unknown
  level?: unknown
  seq?: unknown
  timestamp?: unknown
  ts?: unknown
  url?: unknown
  hostname?: unknown
  tabId?: unknown
  dropped?: unknown
  reason?: unknown
}

export function logLevelRank(level: string): number {
  const normalized = level === 'log' ? 'info' : level
  const index = (LOG_LEVEL_ORDER as readonly string[]).indexOf(normalized)

  return index === -1 ? LOG_LEVEL_ORDER.length : index
}

/** The level filter as the query reads it, or undefined for a name it refuses. */
export function parseLogLevelFilter(
  value: unknown
): (typeof LOG_LEVEL_FILTERS)[number] | undefined {
  if (value == null || value === '') return 'all'

  const text = String(value).trim().toLowerCase()
  const level = text === 'log' ? 'info' : text

  return (LOG_LEVEL_FILTERS as readonly string[]).includes(level)
    ? (level as (typeof LOG_LEVEL_FILTERS)[number])
    : undefined
}

function toContextNames(context: LogQuery['context']): string[] {
  if (context == null) return []

  const list = Array.isArray(context) ? context : String(context).split(',')

  return list.map((name) => String(name).trim()).filter(Boolean)
}

/** The names in a context filter that no producer emits; empty when it is valid. */
export function unknownLogContexts(context: LogQuery['context']): string[] {
  return toContextNames(context).filter(
    (name) =>
      name.toLowerCase() !== 'all' &&
      !(LOG_CONTEXTS as readonly string[]).includes(name)
  )
}

function toContextSet(context: LogQuery['context']): Set<string> | null {
  const names = toContextNames(context)

  if (names.length === 0) return null
  if (names.some((name) => name.toLowerCase() === 'all')) return null

  return new Set(names)
}

/** Why a query cannot be answered as written, or null when every clause is valid. */
export function logQueryProblem(query: LogQuery): string | null {
  const unknown = unknownLogContexts(query.context)

  if (unknown.length > 0) {
    return (
      `context expects a comma-separated list of ${LOG_CONTEXTS.join(', ')} ` +
      `or all, got: ${unknown.join(', ')}`
    )
  }

  if (parseLogLevelFilter(query.level) === undefined) {
    return `level expects one of ${LOG_LEVEL_FILTERS.join(', ')}, got: ${String(query.level)}`
  }

  return null
}

function makeUrlMatcher(pattern: string): (event: LogEventLike) => boolean {
  const escaped = pattern.includes('*')
    ? pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    : null
  const expression = escaped == null ? null : new RegExp(escaped)

  return (event) => {
    const candidates = [event.url, event.hostname].filter(
      (value) => typeof value === 'string'
    ) as string[]
    if (candidates.length === 0) return false

    return candidates.some((candidate) =>
      expression ? expression.test(candidate) : candidate.includes(pattern)
    )
  }
}

/** How a `since` value is read: a sequence number, or a point in time. */
export type LogSince = {seq: number} | {time: number}

// A bare number is a sequence number; anything else must parse as a date, so
// an ISO timestamp filters by the event clock instead of matching nothing.
export function parseLogSince(value: unknown): LogSince | null | undefined {
  if (value == null || value === '') return null

  if (typeof value === 'number') {
    return Number.isFinite(value) ? {seq: value} : undefined
  }

  const text = String(value).trim()
  if (/^\d+(?:\.\d+)?$/.test(text)) return {seq: Number(text)}

  const time = Date.parse(text)

  return Number.isFinite(time) ? {time} : undefined
}

function eventTime(event: LogEventLike): number | null {
  if (typeof event.timestamp === 'number') return event.timestamp

  if (typeof event.ts === 'string') {
    const parsed = Date.parse(event.ts)

    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

export function isAfterSince(event: LogEventLike, since: LogSince): boolean {
  if ('seq' in since) {
    return !(typeof event.seq === 'number' && event.seq <= since.seq)
  }

  const time = eventTime(event)

  return time == null || time > since.time
}

function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null

  const parsed = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(parsed) ? parsed : null
}

/** True when the event passes every clause; a RangeError names a clause the query cannot mean. */
export function matchesLogQuery(event: LogEventLike, query: LogQuery): boolean {
  const problem = logQueryProblem(query)
  if (problem) throw new RangeError(problem)

  if (!event || typeof event !== 'object') return false
  // The first line of a logs.ndjson generation is a header record, never a log.
  if (event.type === 'header') return false

  const minLevel = parseLogLevelFilter(query.level) ?? 'all'
  if (minLevel === 'off') return false

  // A gap stands for events the writer lost. Their fields are gone, so no
  // clause can judge them, and hiding the gap would hide the loss itself.
  if (event.type === 'gap') return true

  if (query.signalsOnly && event.eventType !== 'dx.signal') return false

  const contexts = toContextSet(query.context)
  if (contexts && !contexts.has(String(event.context))) return false

  if (minLevel !== 'all') {
    if (logLevelRank(String(event.level || '')) > logLevelRank(minLevel)) {
      return false
    }
  }

  const since = parseLogSince(query.since)
  if (since && !isAfterSince(event, since)) return false

  if (query.url && !makeUrlMatcher(query.url)(event)) return false

  const tabId = toFiniteNumber(query.tab)
  if (tabId != null && event.tabId !== tabId) return false

  return true
}

/**
 * One-shot read of a session's logs.ndjson. Returns an empty array when the
 * session has never written one: an absent file is "nothing logged yet", and
 * making that a throw would force every caller to guard it.
 */
export function readLogEvents(
  projectPath: string,
  browser = 'chrome',
  query: LogQuery = {}
): LogEventLike[] {
  let raw: string

  try {
    raw = fs.readFileSync(logsPath(projectPath, browser), 'utf-8')
  } catch {
    return []
  }

  const events: LogEventLike[] = []

  for (const line of raw.split('\n')) {
    if (!line) continue

    let event: LogEventLike

    try {
      event = JSON.parse(line)
    } catch {
      continue
    }

    if (matchesLogQuery(event, query)) events.push(event)
  }

  return events
}
