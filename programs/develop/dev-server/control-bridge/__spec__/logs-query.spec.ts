import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {logsPath} from '../../../lib/session-paths'
import {logLevelRank, matchesLogQuery, readLogEvents} from '../logs-query'

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

  it('treats all and off as no level filter', () => {
    for (const level of ['all', 'off']) {
      expect(matchesLogQuery(event({level: 'trace'}), {level})).toBe(true)
    }
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

  it('skips malformed lines instead of throwing on them', () => {
    const file = logsPath(projectPath, 'firefox')
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, `not json\n${JSON.stringify(event({seq: 9}))}\n`)

    expect(readLogEvents(projectPath, 'firefox').map((e) => e.seq)).toEqual([9])
  })
})
