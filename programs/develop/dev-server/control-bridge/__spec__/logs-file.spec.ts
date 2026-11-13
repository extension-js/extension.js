import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import type {LogEvent} from '../contracts'
import {
  isLogFileOwnedByAnotherRun,
  LogsFileWriter,
  readLogFileRunId
} from '../logs-file'

let dir: string
let logPath: string

function event(seq: number, message: string): LogEvent {
  return {
    v: 1,
    id: `id-${seq}`,
    seq,
    timestamp: 0,
    level: 'info',
    context: 'background',
    messageParts: [message],
    runId: 'run-A'
  }
}

function lines(file: string): any[] {
  if (!fs.existsSync(file)) return []

  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-logs-'))
  logPath = path.join(dir, 'logs.ndjson')
})

afterEach(() => {
  fs.rmSync(dir, {recursive: true, force: true})
})

describe('LogsFileWriter', () => {
  it('writes a header line first', () => {
    const w = new LogsFileWriter({filePath: logPath, runId: 'run-A'})
    w.start()
    w.close()
    const out = lines(logPath)
    expect(out[0]).toMatchObject({type: 'header', v: 1, runId: 'run-A'})
    expect(out[0].startedAt).toBeTypeOf('string')
  })

  it('appends events one per line after the header', () => {
    const w = new LogsFileWriter({filePath: logPath, runId: 'run-A'})
    w.start()
    w.write(event(1, 'a'))
    w.write(event(2, 'b'))
    w.flush()
    w.close()
    const out = lines(logPath)
    expect(out).toHaveLength(3)
    expect(out[1]).toMatchObject({seq: 1, messageParts: ['a']})
    expect(out[2]).toMatchObject({seq: 2, messageParts: ['b']})
  })

  it('rotates a pre-existing file to .1 on start (fresh file per run)', () => {
    fs.writeFileSync(logPath, '{"old":true}\n', 'utf-8')
    const w = new LogsFileWriter({filePath: logPath, runId: 'run-B'})
    w.start()
    w.close()
    expect(lines(logPath)[0]).toMatchObject({type: 'header', runId: 'run-B'})
    const rotated = path.join(dir, 'logs.1.ndjson')
    expect(lines(rotated)[0]).toEqual({old: true})
  })

  it('rotates when maxLines is exceeded and starts a fresh header', () => {
    const w = new LogsFileWriter({
      filePath: logPath,
      runId: 'run-A',
      maxLines: 3
    })
    w.start()
    w.write(event(1, 'a'))
    w.write(event(2, 'b'))
    w.flush()
    w.close()
    expect(lines(logPath)).toHaveLength(1)
    expect(lines(logPath)[0]).toMatchObject({type: 'header'})
    const rotated = lines(path.join(dir, 'logs.1.ndjson'))
    expect(rotated).toHaveLength(3)
    expect(rotated[1]).toMatchObject({seq: 1})
  })

  it('keeps only `generations` rotated copies', () => {
    const w = new LogsFileWriter({
      filePath: logPath,
      runId: 'run-A',
      maxLines: 1,
      generations: 2
    })
    w.start()

    for (let i = 1; i <= 4; i++) {
      w.write(event(i, `m${i}`))
      w.flush()
    }

    w.close()
    expect(fs.existsSync(path.join(dir, 'logs.1.ndjson'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'logs.2.ndjson'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'logs.3.ndjson'))).toBe(false)
  })

  it('is a no-op safe before start / after close', () => {
    const w = new LogsFileWriter({filePath: logPath, runId: 'run-A'})
    expect(() => w.write(event(1, 'x'))).not.toThrow()
    expect(() => w.flush()).not.toThrow()
    w.start()
    w.close()
    expect(() => w.flush()).not.toThrow()
  })

  it('a late flush never appends to the file a newer run took', () => {
    const old = new LogsFileWriter({filePath: logPath, runId: 'run-A'})
    old.start()
    old.write(event(1, 'flushed in time'))
    old.flush()
    // Queued when the next session starts, flushed only as this one exits.
    old.write(event(2, 'late'))

    const next = new LogsFileWriter({filePath: logPath, runId: 'run-B'})
    next.start()
    next.write({...event(3, 'fresh'), runId: 'run-B'})
    next.flush()

    old.close()
    next.close()

    const current = lines(logPath)
    expect(current[0]).toMatchObject({type: 'header', runId: 'run-B'})
    expect(current.slice(1).map((l) => l.runId)).toEqual(['run-B'])

    // The rows the old run flushed in time stay in its rotated generation.
    const rotated = lines(path.join(dir, 'logs.1.ndjson'))
    expect(rotated[0]).toMatchObject({type: 'header', runId: 'run-A'})
    expect(rotated.slice(1).map((l) => l.messageParts[0])).toEqual([
      'flushed in time'
    ])
  })

  it('a superseded run neither rotates nor rewrites the newer file', () => {
    const old = new LogsFileWriter({
      filePath: logPath,
      runId: 'run-A',
      maxLines: 2,
      maxQueue: 1
    })
    old.start()

    const next = new LogsFileWriter({filePath: logPath, runId: 'run-B'})
    next.start()

    // Enough rows to overflow the queue and to cross the rotation budget.
    for (let i = 1; i <= 5; i++) old.write(event(i, `late-${i}`))

    old.flush()
    old.close()
    next.close()

    expect(lines(logPath)).toHaveLength(1)
    expect(lines(logPath)[0]).toMatchObject({type: 'header', runId: 'run-B'})
    expect(fs.existsSync(path.join(dir, 'logs.2.ndjson'))).toBe(false)
  })

  it('keeps appending after its own rotation', () => {
    const w = new LogsFileWriter({
      filePath: logPath,
      runId: 'run-A',
      maxLines: 3
    })
    w.start()

    for (const message of ['first', 'second', 'third']) {
      w.write(event(1, message))
      w.flush()
    }

    w.close()

    expect(lines(logPath).map((l) => l.messageParts?.[0])).toEqual([
      undefined,
      'third'
    ])

    expect(lines(logPath)[0]).toMatchObject({rotatedFrom: 'run-A'})
  })

  it('still appends when the file went missing under it', () => {
    const w = new LogsFileWriter({filePath: logPath, runId: 'run-A'})
    w.start()
    fs.rmSync(logPath, {force: true})
    w.write(event(1, 'after delete'))
    w.close()

    expect(lines(logPath).map((l) => l.messageParts[0])).toEqual([
      'after delete'
    ])
  })
})

describe('readLogFileRunId', () => {
  it('reads the run id from a header that ends in CRLF', () => {
    fs.writeFileSync(
      logPath,
      `${JSON.stringify({v: 1, type: 'header', runId: 'run-A'})}\r\n${JSON.stringify(event(1, 'a'))}\r\n`
    )

    expect(readLogFileRunId(logPath)).toBe('run-A')
    expect(isLogFileOwnedByAnotherRun(logPath, 'run-A')).toBe(false)
    expect(isLogFileOwnedByAnotherRun(logPath, 'run-B')).toBe(true)
  })

  it('names no owner for a missing, empty or headerless file', () => {
    expect(readLogFileRunId(logPath)).toBeUndefined()
    expect(isLogFileOwnedByAnotherRun(logPath, 'run-A')).toBe(false)

    fs.writeFileSync(logPath, '')
    expect(isLogFileOwnedByAnotherRun(logPath, 'run-A')).toBe(false)

    fs.writeFileSync(logPath, `${JSON.stringify(event(1, 'a'))}\n`)
    expect(readLogFileRunId(logPath)).toBeUndefined()
    expect(isLogFileOwnedByAnotherRun(logPath, 'run-B')).toBe(false)
  })
})
