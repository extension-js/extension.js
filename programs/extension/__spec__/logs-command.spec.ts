import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const readReadyContract = vi.fn((): unknown => null)

vi.mock('../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopBridgeModule: vi.fn(async () => ({
    readReadyContract: (...args: unknown[]) =>
      readReadyContract(...(args as [])),
    BridgeConsumer: class {
      start() {}
      close() {}
    }
  }))
}))

import {registerLogsCommand} from '../commands/logs'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

const EVENTS = [
  {v: 1, type: 'header', runId: 'r'},
  {seq: 1, level: 'info', context: 'background', messageParts: ['boot']},
  {
    seq: 2,
    level: 'warn',
    context: 'content',
    messageParts: ['careful'],
    url: 'https://example.com/page',
    tabId: 7
  },
  {
    seq: 3,
    level: 'error',
    context: 'content',
    messageParts: ['broken'],
    code: 'E_X',
    remediation: 'restart it',
    hostname: 'other.test',
    tabId: 9
  },
  {
    seq: 4,
    level: 'debug',
    context: 'popup',
    messageParts: [{k: 'v'}],
    eventType: 'dx.signal'
  }
]

let dir: string
let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stubProcessExit()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-logs-'))
  const out = path.join(dir, 'dist', 'extension-js', 'chromium')
  fs.mkdirSync(out, {recursive: true})
  fs.writeFileSync(
    path.join(out, 'logs.ndjson'),
    [...EVENTS.map((e) => JSON.stringify(e)), 'not-json'].join('\n'),
    'utf8'
  )
  readReadyContract.mockReturnValue(null)
})

afterEach(() => {
  fs.rmSync(dir, {recursive: true, force: true})
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function run(argv: string[]) {
  return runCli(makeProgram(registerLogsCommand), argv)
}

function printedLines(): string[] {
  return logSpy.mock.calls.map((call) => String(call[0]))
}

describe('extension logs (one-shot)', () => {
  it('prints every event, skipping the header and bad lines', async () => {
    expect(await run(['logs', dir, '--output', 'ndjson'])).toBe(0)
    expect(printedLines()).toHaveLength(4)
  })

  it('formats pretty output with code and remediation', async () => {
    expect(await run(['logs', dir, '--output', 'pretty'])).toBe(0)
    const broken = printedLines().find((l) => l.includes('broken'))
    expect(broken).toContain('ERROR')
    expect(broken).toContain('E_X')
    expect(broken).toContain('restart it')
    expect(printedLines().some((l) => l.includes('{"k":"v"}'))).toBe(true)
  })

  it('supports json output', async () => {
    expect(
      await run(['logs', dir, '--output', 'json', '--context', 'background'])
    ).toBe(0)
    expect(JSON.parse(printedLines()[0])).toMatchObject({seq: 1})
  })

  it('filters by minimum level', async () => {
    expect(
      await run(['logs', dir, '--output', 'ndjson', '--level', 'warn'])
    ).toBe(0)
    const seqs = printedLines().map((l) => JSON.parse(l).seq)
    expect(seqs).toEqual([2, 3])
  })

  it('filters by context, tab, since, and url glob', async () => {
    expect(
      await run(['logs', dir, '--output', 'ndjson', '--context', 'content'])
    ).toBe(0)
    expect(printedLines().map((l) => JSON.parse(l).seq)).toEqual([2, 3])

    logSpy.mockClear()
    expect(await run(['logs', dir, '--output', 'ndjson', '--tab', '7'])).toBe(0)
    expect(printedLines().map((l) => JSON.parse(l).seq)).toEqual([2])

    logSpy.mockClear()
    expect(await run(['logs', dir, '--output', 'ndjson', '--since', '2'])).toBe(
      0
    )
    expect(printedLines().map((l) => JSON.parse(l).seq)).toEqual([3, 4])

    logSpy.mockClear()
    expect(
      await run(['logs', dir, '--output', 'ndjson', '--url', '*example.com*'])
    ).toBe(0)
    expect(printedLines().map((l) => JSON.parse(l).seq)).toEqual([2])

    logSpy.mockClear()
    expect(
      await run(['logs', dir, '--output', 'ndjson', '--url', 'other.test'])
    ).toBe(0)
    expect(printedLines().map((l) => JSON.parse(l).seq)).toEqual([3])
  })

  it('shows only dx.signal events with --signals-only', async () => {
    expect(
      await run(['logs', dir, '--output', 'ndjson', '--signals-only'])
    ).toBe(0)
    expect(printedLines().map((l) => JSON.parse(l).seq)).toEqual([4])
  })

  it('defaults to ndjson when stdout is not a TTY and no --output is set', async () => {
    const savedIsTTY = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      configurable: true
    })
    try {
      expect(await run(['logs', dir, '--context', 'background'])).toBe(0)
      expect(JSON.parse(printedLines()[0])).toMatchObject({seq: 1})
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: savedIsTTY,
        configurable: true
      })
    }
  })

  it('exits 1 when no logs file exists for the browser', async () => {
    expect(
      await run(['logs', dir, '--output', 'ndjson', '--browser', 'firefox'])
    ).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('No logs found')
  })
})

describe('extension logs --follow', () => {
  it('exits 1 when no dev session control channel is active', async () => {
    expect(await run(['logs', dir, '--follow', '--output', 'ndjson'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain(
      'No active dev session control channel'
    )
  })
})
