// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {logsPath} from '../../lib/session-paths'

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

export type LogLevelFilter =
  | (typeof LOG_LEVEL_ORDER)[number]
  | 'all'
  | 'off'
  | (string & {})

export interface LogQuery {
  /** One context, a comma-separated list, an array, or 'all'. */
  context?: string | string[]
  /** Minimum severity. 'all' and 'off' select every level. */
  level?: LogLevelFilter
  /** Only structured dx.signal diagnostics. */
  signalsOnly?: boolean
  /** Only events whose seq is strictly greater than this. */
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
  url?: unknown
  hostname?: unknown
  tabId?: unknown
}

export function logLevelRank(level: string): number {
  const normalized = level === 'log' ? 'info' : level
  const index = (LOG_LEVEL_ORDER as readonly string[]).indexOf(normalized)
  return index === -1 ? LOG_LEVEL_ORDER.length : index
}

function toContextSet(context: LogQuery['context']): Set<string> | null {
  if (context == null) return null
  const list = Array.isArray(context) ? context : String(context).split(',')
  const names = list.map((name) => name.trim()).filter(Boolean)
  if (names.length === 0) return null
  if (names.length === 1 && names[0].toLowerCase() === 'all') return null
  return new Set(names)
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

function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** True when the event passes every clause of the query. */
export function matchesLogQuery(event: LogEventLike, query: LogQuery): boolean {
  if (!event || typeof event !== 'object') return false
  // The first line of a logs.ndjson generation is a header record, never a log.
  if (event.type === 'header') return false

  if (query.signalsOnly && event.eventType !== 'dx.signal') return false

  const contexts = toContextSet(query.context)
  if (contexts && !contexts.has(String(event.context))) return false

  const minLevel = String(query.level ?? 'all').toLowerCase()
  if (minLevel !== 'all' && minLevel !== 'off') {
    if (logLevelRank(String(event.level || '')) > logLevelRank(minLevel)) {
      return false
    }
  }

  const since = toFiniteNumber(query.since)
  if (since != null && typeof event.seq === 'number' && event.seq <= since) {
    return false
  }

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
