import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {LogsFileWriter} from '../logs-file'
import type {LogEvent} from '../contracts'

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
    expect(out).toHaveLength(3) // header + 2
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
    w.start() // header = 1 line
    w.write(event(1, 'a'))
    w.write(event(2, 'b'))
    w.flush() // 1 + 2 = 3 >= 3 -> rotate
    w.close()
    // current file is a fresh header only
    expect(lines(logPath)).toHaveLength(1)
    expect(lines(logPath)[0]).toMatchObject({type: 'header'})
    // rotated file holds header + the two events
    const rotated = lines(path.join(dir, 'logs.1.ndjson'))
    expect(rotated).toHaveLength(3)
    expect(rotated[1]).toMatchObject({seq: 1})
  })

  it('keeps only `generations` rotated copies', () => {
    const w = new LogsFileWriter({
      filePath: logPath,
      runId: 'run-A',
      maxLines: 1, // every flush rotates
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
})
