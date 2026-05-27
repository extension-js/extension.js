import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {ActionsFileWriter, fnv1aHex, type ActionRecord} from '../actions-file'

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
    // No header line (the actions schema is closed).
    expect(first.type).toBeUndefined()
    expect(JSON.parse(lines[1])).toMatchObject({cmdId: 'b', ok: false, errorName: 'Timeout'})
  })

  it('rotates the prior file on start so a run begins clean', () => {
    const w1 = new ActionsFileWriter({filePath: file})
    w1.start()
    w1.write(rec('old'))
    const w2 = new ActionsFileWriter({filePath: file})
    w2.start() // should rotate the existing file to actions.1.ndjson
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
    w.write(rec('2')) // hits maxLines -> rotate
    w.write(rec('3'))
    expect(fs.existsSync(file.replace(/\.ndjson$/, '.1.ndjson'))).toBe(true)
    const current = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
    expect(current.map((l) => JSON.parse(l).cmdId)).toEqual(['3'])
  })
})

describe('fnv1aHex', () => {
  it('is stable and 8 hex chars', () => {
    expect(fnv1aHex('chrome.runtime.id')).toBe(fnv1aHex('chrome.runtime.id'))
    expect(fnv1aHex('a')).toMatch(/^[0-9a-f]{8}$/)
    expect(fnv1aHex('a')).not.toBe(fnv1aHex('b'))
  })
})
