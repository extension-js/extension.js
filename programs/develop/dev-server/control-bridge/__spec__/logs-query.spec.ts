import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {logsPath} from '../../../lib/session-paths'
import {LOG_CONTEXTS} from '../contracts'
import {
  LOG_LEVEL_FILTERS,
  logLevelRank,
  logQueryProblem,
  matchesLogQuery,
  parseLogLevelFilter,
  parseLogSince,
  readLogEvents,
  unknownLogContexts
} from '../logs-query'

const event = (over: Record<string, unknown> = {}) => ({
  seq: 1,
  level: 'info',
  context: 'background',
  eventType: 'log',
  ...over
})

describe('matchesLogQuery', () => {
  it('drops the generation header, which is not a log record', () => {
    expect(matchesLogQuery({type: 'header'}, {})).toBe(false)
  })

  it('selects a level plus everything more severe', () => {
    expect(matchesLogQuery(event({level: 'error'}), {level: 'warn'})).toBe(true)
    expect(matchesLogQuery(event({level: 'warn'}), {level: 'warn'})).toBe(true)
    expect(matchesLogQuery(event({level: 'info'}), {level: 'warn'})).toBe(false)
  })

  it('ranks `log` as `info`', () => {
    expect(logLevelRank('log')).toBe(logLevelRank('info'))
    expect(matchesLogQuery(event({level: 'log'}), {level: 'info'})).toBe(true)
  })

  it('treats all as no level filter and off as no level at all', () => {
    expect(matchesLogQuery(event({level: 'trace'}), {level: 'all'})).toBe(true)
    expect(matchesLogQuery(event({level: 'error'}), {level: 'off'})).toBe(false)
    expect(matchesLogQuery({type: 'gap', dropped: 3}, {level: 'off'})).toBe(
      false
    )
  })

  it('refuses a level it does not know instead of selecting everything', () => {
    expect(() => matchesLogQuery(event(), {level: 'bogus'})).toThrow(
      'level expects one of off, error, warn, info, debug, trace, all, got: bogus'
    )

    expect(logQueryProblem({level: 'WARN'})).toBeNull()
    expect(parseLogLevelFilter('WARN')).toBe('warn')
    expect(parseLogLevelFilter(undefined)).toBe('all')
    expect(parseLogLevelFilter('bogus')).toBeUndefined()
    expect(LOG_LEVEL_FILTERS).toEqual([
      'off',
      'error',
      'warn',
      'info',
      'debug',
      'trace',
      'all'
    ])
  })

  it('refuses a context it does not name, mis-cased included, naming the valid set', () => {
    for (const context of ['bogus', 'Background', 'all,bogus']) {
      expect(() => matchesLogQuery(event(), {context})).toThrow(RangeError)
    }

    expect(logQueryProblem({context: 'content,Popup'})).toBe(
      'context expects a comma-separated list of background, content, page, ' +
        'popup, options, sidebar, devtools, newtab, history, bookmarks or all, got: Popup'
    )

    expect(unknownLogContexts(['page', 'newtab', 'nope'])).toEqual(['nope'])
    expect(unknownLogContexts('all')).toEqual([])
    expect(logQueryProblem({context: LOG_CONTEXTS.join(',')})).toBeNull()
  })

  // `page` was a filter value at 4.1.30 and the Firefox relay still stamps it.
  it('keeps page as a context a query may name', () => {
    expect(LOG_CONTEXTS).toContain('page')
    expect(matchesLogQuery(event({context: 'page'}), {context: 'page'})).toBe(
      true
    )

    expect(
      matchesLogQuery(event({context: 'content'}), {context: ['page']})
    ).toBe(false)
  })

  it('lets all compose inside a context list', () => {
    expect(
      matchesLogQuery(event({context: 'popup'}), {context: 'all,content'})
    ).toBe(true)

    expect(
      matchesLogQuery(event({context: 'history'}), {
        context: ['content', 'ALL']
      })
    ).toBe(true)
  })

  // A gap has none of the fields a clause reads, so a filtered read never
  // returns one unless asked: every row it returns is then a log event.
  it('drops a gap sentinel under any clause unless the query asks for gaps', () => {
    const gap = {v: 1, type: 'gap', reason: 'disk_slow', dropped: 4211}
    expect(matchesLogQuery(gap, {})).toBe(true)
    expect(matchesLogQuery(gap, {level: 'all'})).toBe(true)
    expect(matchesLogQuery(gap, {level: 'error'})).toBe(false)
    expect(matchesLogQuery(gap, {context: 'content'})).toBe(false)
    expect(matchesLogQuery(gap, {signalsOnly: true})).toBe(false)
    expect(matchesLogQuery(gap, {url: 'example', tab: 7})).toBe(false)

    expect(matchesLogQuery(gap, {level: 'error', includeGaps: true})).toBe(true)
    expect(
      matchesLogQuery(gap, {context: 'content', tab: 7, includeGaps: true})
    ).toBe(true)

    expect(matchesLogQuery(gap, {level: 'off', includeGaps: true})).toBe(false)
  })

  it('accepts a context list as a string or an array', () => {
    expect(
      matchesLogQuery(event({context: 'content'}), {
        context: 'background,content'
      })
    ).toBe(true)

    expect(
      matchesLogQuery(event({context: 'popup'}), {
        context: ['background', 'content']
      })
    ).toBe(false)

    expect(matchesLogQuery(event({context: 'popup'}), {context: 'all'})).toBe(
      true
    )
  })

  it('keeps only structured signals under signalsOnly', () => {
    expect(
      matchesLogQuery(event({eventType: 'dx.signal'}), {
        signalsOnly: true
      })
    ).toBe(true)

    expect(matchesLogQuery(event(), {signalsOnly: true})).toBe(false)
  })

  it('matches url as a glob or a plain substring, over url then hostname', () => {
    const withUrl = event({url: 'https://example.com/a/b'})
    expect(matchesLogQuery(withUrl, {url: 'example.com'})).toBe(true)
    expect(matchesLogQuery(withUrl, {url: 'https://*/a/*'})).toBe(true)
    expect(matchesLogQuery(withUrl, {url: 'other.com'})).toBe(false)
    expect(
      matchesLogQuery(event({hostname: 'example.com'}), {url: 'example'})
    ).toBe(true)

    // No url and no hostname cannot match a url filter.
    expect(matchesLogQuery(event(), {url: 'example'})).toBe(false)
  })

  it('reads an ISO since against the event clock, and refuses garbage', () => {
    const at = Date.parse('2026-09-05T12:00:00.000Z')
    expect(parseLogSince('2026-09-05T12:00:00Z')).toEqual({time: at})
    expect(parseLogSince('12')).toEqual({seq: 12})
    expect(parseLogSince('yesterday-ish')).toBeUndefined()
    expect(parseLogSince('')).toBeNull()
    const since = '2026-09-05T12:00:00Z'
    expect(matchesLogQuery(event({seq: 1, timestamp: at - 1}), {since})).toBe(
      false
    )

    expect(matchesLogQuery(event({seq: 2, timestamp: at}), {since})).toBe(false)
    expect(matchesLogQuery(event({seq: 3, timestamp: at + 1}), {since})).toBe(
      true
    )

    expect(
      matchesLogQuery(event({seq: 4, ts: '2026-09-05T12:00:01.000Z'}), {since})
    ).toBe(true)
  })

  it('takes since as exclusive and accepts it as a string', () => {
    expect(matchesLogQuery(event({seq: 5}), {since: 5})).toBe(false)
    expect(matchesLogQuery(event({seq: 6}), {since: 5})).toBe(true)
    expect(matchesLogQuery(event({seq: 6}), {since: '5'})).toBe(true)
  })

  it('filters by tab id given as a number or a string', () => {
    expect(matchesLogQuery(event({tabId: 7}), {tab: 7})).toBe(true)
    expect(matchesLogQuery(event({tabId: 7}), {tab: '7'})).toBe(true)
    expect(matchesLogQuery(event({tabId: 8}), {tab: 7})).toBe(false)
  })
})

describe('readLogEvents', () => {
  let projectPath: string

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-logs-query-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(projectPath, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  })

  function write(browser: string, lines: unknown[]) {
    const file = logsPath(projectPath, browser)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(
      file,
      `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`
    )
  }

  it('returns an empty list when the session never wrote a log file', () => {
    expect(readLogEvents(projectPath, 'chromium')).toEqual([])
  })

  it('reads the per-browser file and applies the query', () => {
    write('chromium', [
      {type: 'header', runId: 'r-1'},
      event({seq: 1, level: 'info'}),
      event({seq: 2, level: 'error', context: 'content'}),
      event({seq: 3, level: 'warn'})
    ])

    const all = readLogEvents(projectPath, 'chromium')
    expect(all).toHaveLength(3)

    const errors = readLogEvents(projectPath, 'chromium', {level: 'error'})
    expect(errors.map((e) => e.seq)).toEqual([2])
  })

  it('returns the gap sentinel only to an unfiltered read, or one that asks', () => {
    const gap = {v: 1, type: 'gap', reason: 'disk_slow', dropped: 4211}
    write('chromium', [
      {type: 'header', runId: 'r-1'},
      event({seq: 1, level: 'error'}),
      gap,
      event({seq: 2, level: 'info'}),
      event({seq: 3, level: 'error'})
    ])

    expect(readLogEvents(projectPath, 'chromium', {level: 'error'})).toEqual([
      event({seq: 1, level: 'error'}),
      event({seq: 3, level: 'error'})
    ])

    expect(
      readLogEvents(projectPath, 'chromium', {
        level: 'error',
        includeGaps: true
      })
    ).toEqual([
      event({seq: 1, level: 'error'}),
      gap,
      event({seq: 3, level: 'error'})
    ])

    expect(
      readLogEvents(projectPath, 'chromium').map((e) => e.type ?? e.seq)
    ).toEqual([1, 'gap', 2, 3])

    expect(readLogEvents(projectPath, 'chromium', {level: 'off'})).toEqual([])
    expect(readLogEvents(projectPath, 'chromium', {context: 'page'})).toEqual(
      []
    )

    expect(() =>
      readLogEvents(projectPath, 'chromium', {context: 'nope'})
    ).toThrow(RangeError)
  })

  it('skips malformed lines instead of throwing on them', () => {
    const file = logsPath(projectPath, 'firefox')
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, `not json\n${JSON.stringify(event({seq: 9}))}\n`)

    expect(readLogEvents(projectPath, 'firefox').map((e) => e.seq)).toEqual([9])
  })
})
