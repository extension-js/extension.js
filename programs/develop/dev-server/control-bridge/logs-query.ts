// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {logsPath} from '../../lib/session-paths'
import {type LogEventLike, type LogQuery, matchesLogQuery} from './log-rule'

export * from './log-rule'

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
