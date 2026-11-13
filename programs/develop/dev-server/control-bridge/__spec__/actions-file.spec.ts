import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {type ActionRecord, ActionsFileWriter, fnv1aHex} from '../actions-file'
import {LogsFileWriter} from '../logs-file'

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-actions-'))
  file = path.join(dir, 'actions.ndjson')
})

afterEach(() => {
  fs.rmSync(dir, {recursive: true, force: true})
})

function rec(cmdId: string, extra: Partial<ActionRecord> = {}): ActionRecord {
  return {
    v: 1,
    ts: '2026-05-27T00:00:00.000Z',
    cmdId,
    op: 'reload',
    target: {context: 'background'},
    ok: true,
    principal: 'controller',
    ...extra
  }
}

describe('ActionsFileWriter', () => {
  it('appends one JSON line per record with no header', () => {
    const w = new ActionsFileWriter({filePath: file})
    w.start()
    w.write(rec('a'))
    w.write(rec('b', {ok: false, errorName: 'Timeout'}))
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0])
    expect(first).toMatchObject({v: 1, cmdId: 'a', op: 'reload', ok: true})
    expect(first.type).toBeUndefined()
    expect(JSON.parse(lines[1])).toMatchObject({
      cmdId: 'b',
      ok: false,
      errorName: 'Timeout'
    })
  })

  it('rotates the prior file on start so a run begins clean', () => {
    const w1 = new ActionsFileWriter({filePath: file})
    w1.start()
    w1.write(rec('old'))
    const w2 = new ActionsFileWriter({filePath: file})
    w2.start()
    w2.write(rec('new'))
    expect(fs.existsSync(file.replace(/\.ndjson$/, '.1.ndjson'))).toBe(true)
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).cmdId).toBe('new')
  })

  it('rotates when maxLines is exceeded', () => {
    const w = new ActionsFileWriter({filePath: file, maxLines: 2})
    w.start()
    w.write(rec('1'))
    w.write(rec('2'))
    w.write(rec('3'))
    expect(fs.existsSync(file.replace(/\.ndjson$/, '.1.ndjson'))).toBe(true)
    const current = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
    expect(current.map((l) => JSON.parse(l).cmdId)).toEqual(['3'])
  })
})

describe('ActionsFileWriter run ownership', () => {
  function cmdIds(target: string): string[] {
    if (!fs.existsSync(target)) return []

    return fs
      .readFileSync(target, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => JSON.parse(l).cmdId)
  }

  it('a late write never lands in the file a newer run took', () => {
    const logsFilePath = path.join(dir, 'logs.ndjson')

    const oldLogs = new LogsFileWriter({filePath: logsFilePath, runId: 'run-A'})
    const oldActions = new ActionsFileWriter({
      filePath: file,
      owner: {runId: 'run-A', logsFilePath}
    })
    oldLogs.start()
    oldActions.start()
    oldActions.write(rec('old-in-time'))

    const nextLogs = new LogsFileWriter({
      filePath: logsFilePath,
      runId: 'run-B'
    })
    const nextActions = new ActionsFileWriter({
      filePath: file,
      owner: {runId: 'run-B', logsFilePath}
    })
    nextLogs.start()
    nextActions.start()

    oldActions.write(rec('old-late'))
    nextActions.write(rec('new'))
    oldActions.close()
    // A closed writer restarts on write, which would rotate the newer file.
    oldActions.write(rec('old-after-close'))

    oldLogs.close()
    nextLogs.close()

    expect(cmdIds(file)).toEqual(['new'])
    expect(cmdIds(file.replace(/\.ndjson$/, '.1.ndjson'))).toEqual([
      'old-in-time'
    ])

    expect(fs.existsSync(file.replace(/\.ndjson$/, '.2.ndjson'))).toBe(false)
  })

  it('keeps writing while its own run owns the session', () => {
    const logsFilePath = path.join(dir, 'logs.ndjson')
    const logs = new LogsFileWriter({filePath: logsFilePath, runId: 'run-A'})
    const actions = new ActionsFileWriter({
      filePath: file,
      owner: {runId: 'run-A', logsFilePath}
    })

    logs.start()
    actions.start()
    actions.write(rec('a'))
    logs.close()
    actions.write(rec('b'))

    expect(cmdIds(file)).toEqual(['a', 'b'])
  })

  it('writes when the session log is missing', () => {
    const actions = new ActionsFileWriter({
      filePath: file,
      owner: {runId: 'run-A', logsFilePath: path.join(dir, 'logs.ndjson')}
    })

    actions.write(rec('a'))

    expect(cmdIds(file)).toEqual(['a'])
  })
})

describe('fnv1aHex', () => {
  it('is stable and 8 hex chars', () => {
    expect(fnv1aHex('chrome.runtime.id')).toBe(fnv1aHex('chrome.runtime.id'))
    expect(fnv1aHex('a')).toMatch(/^[0-9a-f]{8}$/)
    expect(fnv1aHex('a')).not.toBe(fnv1aHex('b'))
  })
})
