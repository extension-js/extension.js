import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {LogEvent} from '../../develop/dev-server/control-bridge/contracts'
import {LogsFileWriter} from '../../develop/dev-server/control-bridge/logs-file'

// The one-shot reader against the file the producer actually writes, kind by
// kind: the header line, every event shape, and the gap sentinel. Hand-built
// fixtures cannot catch a writer that changes what it puts on disk.
vi.mock('../helpers/extension-develop-runtime', async () => ({
  loadExtensionDevelopBridgeModule: vi.fn(async () => ({
    ...(await import('../../develop/dev-server/control-bridge/logs-query')),
    readReadyContract: () => null,
    BridgeConsumer: class {
      start() {}
      close() {}
    }
  }))
}))

import {registerLogsCommand} from '../commands/logs'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

const RUN_ID = 'run-roundtrip'

// One event per shape the contract allows: a plain console line, a page
// event carrying its tab and url, an error with a stack, and a dx.signal
// diagnostic with code, status, remediation and data.
const EVENTS: LogEvent[] = [
  {
    v: 1,
    id: 'id-1',
    seq: 1,
    timestamp: 1788620401000,
    level: 'log',
    context: 'background',
    messageParts: ['boot', {ready: true}],
    runId: RUN_ID
  },
  {
    v: 1,
    id: 'id-2',
    seq: 2,
    timestamp: 1788620402000,
    level: 'warn',
    context: 'content',
    messageParts: ['careful'],
    url: 'https://example.com/page',
    hostname: 'example.com',
    tabId: 7,
    frameId: 0,
    windowId: 1,
    title: 'Example',
    incognito: false,
    runId: RUN_ID,
    repeat: 2
  },
  {
    v: 1,
    id: 'id-3',
    seq: 3,
    timestamp: 1788620403000,
    level: 'error',
    context: 'popup',
    messageParts: ['broken'],
    stack: 'Error: broken\n    at popup.js:1:1',
    errorName: 'Error',
    sourceExtensionId: 'abcdefghijklmnopabcdefghijklmnop',
    runId: RUN_ID
  },
  {
    v: 1,
    id: 'id-4',
    seq: 4,
    timestamp: 1788620404000,
    level: 'info',
    context: 'options',
    messageParts: ['signal'],
    eventType: 'dx.signal',
    code: 'E_X',
    status: 'fail',
    remediation: 'restart it',
    data: {detail: 'value'},
    runId: RUN_ID
  }
]

let dir: string
let logSpy: ReturnType<typeof vi.spyOn>

function writeWithProducer(options: {maxQueue?: number} = {}) {
  const out = path.join(dir, 'dist', 'extension-js', 'chromium')
  const writer = new LogsFileWriter({
    filePath: path.join(out, 'logs.ndjson'),
    runId: RUN_ID,
    ...options
  })
  writer.start()
  for (const event of EVENTS) writer.write(event)
  writer.flush()
  writer.close()
  return fs
    .readFileSync(path.join(out, 'logs.ndjson'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

beforeEach(() => {
  stubProcessExit()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-logs-roundtrip-'))
})

afterEach(() => {
  fs.rmSync(dir, {recursive: true, force: true})
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function run(argv: string[]) {
  return runCli(makeProgram(registerLogsCommand), argv)
}

function printed(): unknown[] {
  return logSpy.mock.calls.map((call) => JSON.parse(String(call[0])))
}

describe('extension logs reads what LogsFileWriter writes', () => {
  it('skips the header and prints every event kind unchanged', async () => {
    const onDisk = writeWithProducer()
    expect(onDisk[0]).toMatchObject({type: 'header', runId: RUN_ID})
    expect(onDisk).toHaveLength(EVENTS.length + 1)

    expect(await run(['logs', dir, '--output', 'ndjson'])).toBe(0)
    expect(printed()).toEqual(EVENTS)
  })

  it('passes the gap sentinel through as its own record', async () => {
    // A queue of one keeps only the last event, so the writer notes the
    // drops with a gap line after the batch it did flush.
    const onDisk = writeWithProducer({maxQueue: 1})
    const gap = onDisk.find((record) => record.type === 'gap')
    expect(gap).toMatchObject({v: 1, type: 'gap', reason: 'disk_slow'})
    expect(gap.dropped).toBe(EVENTS.length - 1)

    expect(await run(['logs', dir, '--output', 'ndjson'])).toBe(0)
    expect(printed()).toEqual([EVENTS[EVENTS.length - 1], gap])
  })

  it('filters the producer records the same way the query helpers do', async () => {
    writeWithProducer()

    expect(
      await run(['logs', dir, '--output', 'ndjson', '--level', 'warn'])
    ).toBe(0)
    expect(printed().map((event) => (event as LogEvent).seq)).toEqual([2, 3])

    logSpy.mockClear()
    expect(
      await run(['logs', dir, '--output', 'ndjson', '--url', '*example.com*'])
    ).toBe(0)
    expect(printed().map((event) => (event as LogEvent).seq)).toEqual([2])

    logSpy.mockClear()
    expect(
      await run(['logs', dir, '--output', 'ndjson', '--signals-only'])
    ).toBe(0)
    expect(printed().map((event) => (event as LogEvent).seq)).toEqual([4])
  })

  it('pretty-prints the producer fields the printer names', async () => {
    writeWithProducer()
    logSpy.mockRestore()
    const pretty = vi.spyOn(console, 'log').mockImplementation(() => {})

    expect(await run(['logs', dir, '--output', 'pretty'])).toBe(0)
    const lines = pretty.mock.calls.map((call) => String(call[0]))
    expect(lines[0]).toContain('[1] LOG (background) boot {"ready":true}')
    expect(lines[3]).toContain('[4] INFO (options) E_X signal')
    expect(lines[3]).toContain('restart it')
  })
})
