import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {readRecentConsole} from '../commands/act'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-console-'))
  const d = path.join(dir, 'dist', 'extension-js', 'chromium')
  fs.mkdirSync(d, {recursive: true})
  const lines = [
    {v: 1, type: 'header', runId: 'r'},
    {
      v: 1,
      seq: 1,
      level: 'info',
      context: 'background',
      messageParts: ['bg1'],
      runId: 'r'
    },
    {
      v: 1,
      seq: 2,
      level: 'log',
      context: 'content',
      messageParts: ['c-tab7'],
      tabId: 7,
      runId: 'r'
    },
    {
      v: 1,
      seq: 3,
      level: 'error',
      context: 'content',
      messageParts: ['c-tab9'],
      tabId: 9,
      runId: 'r'
    },
    {
      v: 1,
      seq: 4,
      level: 'log',
      context: 'content',
      messageParts: ['c-tab7-b'],
      tabId: 7,
      runId: 'r'
    }
  ]
  fs.writeFileSync(
    path.join(d, 'logs.ndjson'),
    `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`
  )
})
afterEach(() => fs.rmSync(dir, {recursive: true, force: true}))

describe('readRecentConsole (console-from-buffer)', () => {
  it('filters by context and skips the header', () => {
    const out = readRecentConsole(
      dir,
      'chromium',
      {context: 'content'},
      50
    ) as any[]
    expect(out).toHaveLength(3)
    expect(out.every((e) => e.context === 'content')).toBe(true)
  })

  it('filters by tabId', () => {
    const out = readRecentConsole(
      dir,
      'chromium',
      {context: 'content', tabId: 7},
      50
    ) as any[]
    expect(out.map((e) => e.messageParts[0])).toEqual(['c-tab7', 'c-tab7-b'])
  })

  it('returns the most recent N', () => {
    const out = readRecentConsole(
      dir,
      'chromium',
      {context: 'content'},
      1
    ) as any[]
    expect(out).toHaveLength(1)
    expect(out[0].seq).toBe(4)
  })

  it('returns [] when no logs file exists', () => {
    expect(
      readRecentConsole(`/tmp/nope-${Date.now()}`, 'chromium', {}, 10)
    ).toEqual([])
  })
})
