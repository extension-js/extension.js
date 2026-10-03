import fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const readReadyContract = vi.fn((): unknown => null)

vi.mock('../helpers/extension-develop-runtime', async () => ({
  loadExtensionDevelopBridgeModule: vi.fn(async () => ({
    ...(await import('../../develop/dev-server/control-bridge/logs-query')),
    readReadyContract: (...args: unknown[]) =>
      readReadyContract(...(args as [])),
    BridgeConsumer: class {
      start() {}
      close() {}
    }
  }))
}))

import {LOG_CONTEXTS as BRIDGE_LOG_CONTEXTS} from '../../develop/dev-server/control-bridge/contracts'
import {LOG_CONTEXTS, registerLogsCommand} from '../commands/logs'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

const EVENTS = [
  {v: 1, type: 'header', runId: 'r'},
  {
    seq: 1,
    timestamp: 1788620401000,
    level: 'info',
    context: 'background',
    messageParts: ['boot']
  },
  {
    seq: 2,
    timestamp: 1788620402000,
    level: 'warn',
    context: 'content',
    messageParts: ['careful'],
    url: 'https://example.com/page',
    tabId: 7
  },
  {
    seq: 3,
    timestamp: 1788620403000,
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
    timestamp: 1788620404000,
    level: 'debug',
    context: 'popup',
    messageParts: [{k: 'v'}],
    eventType: 'dx.signal'
  }
]

let dir: string
let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>
let writeSyncSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stubProcessExit()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  writeSyncSpy = vi.spyOn(fs, 'writeSync').mockImplementation(() => 0)
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

function errorLines(): string[] {
  return errorSpy.mock.calls.map((call) => String(call[0]))
}

function writeLogs(records: unknown[]) {
  fs.writeFileSync(
    path.join(dir, 'dist', 'extension-js', 'chromium', 'logs.ndjson'),
    records.map((record) => JSON.stringify(record)).join('\n'),
    'utf8'
  )
}

const GAP = {v: 1, type: 'gap', reason: 'disk_slow', dropped: 4211}

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

  it('colors the level token and dims the context on a color terminal only', async () => {
    const env = {
      FORCE_COLOR: process.env.FORCE_COLOR,
      NO_COLOR: process.env.NO_COLOR
    }

    try {
      process.env.FORCE_COLOR = '1'
      Reflect.deleteProperty(process.env, 'NO_COLOR')
      expect(await run(['logs', dir, '--output', 'pretty'])).toBe(0)
      const colored = printedLines()
      expect(colored[0]).toContain('[90mINFO[39m')
      expect(colored[0]).toContain('[2m(background)[22m')
      expect(colored[1]).toContain('[93mWARN[39m')
      expect(colored[2]).toContain('[31mERROR[39m')
      expect(colored[3]).toContain('[2m[90mDEBUG[39m[22m')

      logSpy.mockClear()
      process.env.FORCE_COLOR = '0'
      process.env.NO_COLOR = '1'
      expect(await run(['logs', dir, '--output', 'pretty'])).toBe(0)
      const plain = printedLines()
      expect(plain[0]).toBe('[1] INFO (background) boot')
      expect(plain[2]).toBe('[3] ERROR (content) E_X broken\n    ↳ restart it')
      expect(plain.some((line) => line.includes('['))).toBe(false)
    } finally {
      process.env.FORCE_COLOR = env.FORCE_COLOR
      process.env.NO_COLOR = env.NO_COLOR
    }
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

  it('selects nothing under --level off', async () => {
    expect(
      await run(['logs', dir, '--output', 'ndjson', '--level', 'off'])
    ).toBe(0)

    expect(printedLines()).toEqual([])
  })

  it('refuses a level it does not know with a mapped usage code', async () => {
    expect(
      await run(['logs', dir, '--output', 'ndjson', '--level', 'bogus'])
    ).toBe(1)

    expect(printedLines()).toEqual([])
    expect(errorLines().join('\n')).toContain(
      '--level expects one of off, error, warn, info, debug, trace, all, got: bogus'
    )

    const frame = JSON.parse(String(writeSyncSpy.mock.calls[0][1]))
    expect(frame).toMatchObject({
      command: 'logs',
      error: {code: 'E_INVALID_OPTION'}
    })
  })

  it('refuses a context it does not name, mis-cased included, naming the valid set', async () => {
    for (const context of ['bogus', 'Background', 'all,bogus']) {
      logSpy.mockClear()
      errorSpy.mockClear()
      writeSyncSpy.mockClear()

      expect(
        await run(['logs', dir, '--output', 'ndjson', '--context', context])
      ).toBe(1)

      expect(printedLines()).toEqual([])
      expect(errorLines().join('\n')).toContain(
        '--context expects a comma-separated list of background, content, page, ' +
          'popup, options, sidebar, devtools, newtab, history, bookmarks or all, got: ' +
          context.replace('all,', '')
      )

      expect(JSON.parse(String(writeSyncSpy.mock.calls[0][1]))).toMatchObject({
        command: 'logs',
        error: {code: 'E_INVALID_OPTION'}
      })
    }

    expect(
      await run(['logs', dir, '--output', 'pretty', '--context', 'bogus'])
    ).toBe(1)
  })

  // `page` was accepted at 4.1.30 and the Firefox relay still stamps it, so
  // a script that filters on it keeps working and the frame stays clean.
  it('accepts page as a context, alone and in a list', async () => {
    writeLogs([EVENTS[0], EVENTS[1], {...EVENTS[2], context: 'page', seq: 5}])

    expect(
      await run(['logs', dir, '--output', 'ndjson', '--context', 'page'])
    ).toBe(0)

    expect(printedLines().map((l) => JSON.parse(l).seq)).toEqual([5])
    expect(writeSyncSpy).not.toHaveBeenCalled()

    logSpy.mockClear()
    expect(
      await run([
        'logs',
        dir,
        '--output',
        'ndjson',
        '--context',
        'background,page'
      ])
    ).toBe(0)

    expect(printedLines().map((l) => JSON.parse(l).seq)).toEqual([1, 5])
  })

  it('lets all compose inside a context list', async () => {
    expect(
      await run(['logs', dir, '--output', 'ndjson', '--context', 'all,content'])
    ).toBe(0)

    expect(printedLines().map((l) => JSON.parse(l).seq)).toEqual([1, 2, 3, 4])
  })

  it('names every context a filter may use, as the bridge names them', () => {
    expect(LOG_CONTEXTS).toEqual([...BRIDGE_LOG_CONTEXTS])
    expect(LOG_CONTEXTS).toContain('page')

    const help = makeProgram(registerLogsCommand).commands[0].helpInformation()
    expect(help).toContain(BRIDGE_LOG_CONTEXTS.join(', '))
    expect(help).toContain('--level <off|error|warn|info|debug|trace|all>')
  })

  it('reports a gap sentinel on stderr under pretty output, with its count', async () => {
    writeLogs([EVENTS[0], EVENTS[3], GAP, EVENTS[4]])

    expect(await run(['logs', dir, '--output', 'pretty'])).toBe(0)
    expect(printedLines()).toHaveLength(2)
    expect(printedLines().join('\n')).not.toContain('undefined')
    expect(errorLines()).toEqual([
      expect.stringContaining('4211 event(s) dropped (disk_slow)')
    ])
  })

  it('prints a gap sentinel as its own row under ndjson and json', async () => {
    writeLogs([EVENTS[0], EVENTS[3], GAP, EVENTS[4]])

    expect(await run(['logs', dir, '--output', 'ndjson'])).toBe(0)
    expect(printedLines().map((l) => JSON.parse(l))).toEqual([
      EVENTS[3],
      GAP,
      EVENTS[4]
    ])

    logSpy.mockClear()
    expect(await run(['logs', dir, '--output', 'json'])).toBe(0)
    expect(printedLines().map((l) => JSON.parse(l))).toEqual([
      EVENTS[3],
      GAP,
      EVENTS[4]
    ])

    expect(errorLines()).toEqual([])
  })

  // A filtered stream is read line by line as log events (the docs pipe it
  // into jq), so the loss is reported on stderr there, never as a row.
  it('reports a gap sentinel on stderr instead of as a row once any filter applies', async () => {
    writeLogs([EVENTS[0], EVENTS[3], GAP, EVENTS[4]])

    for (const filter of [
      ['--level', 'error'],
      ['--context', 'content'],
      ['--tab', '9'],
      ['--url', 'other'],
      ['--signals-only']
    ]) {
      logSpy.mockClear()
      errorSpy.mockClear()

      expect(await run(['logs', dir, '--output', 'ndjson', ...filter])).toBe(0)

      const rows = printedLines().map((l) => JSON.parse(l))
      expect(rows.some((row) => row.type === 'gap')).toBe(false)
      expect(rows.every((row) => Array.isArray(row.messageParts))).toBe(true)
      expect(errorLines().join('\n')).toContain(
        '4211 event(s) dropped (disk_slow)'
      )
    }

    logSpy.mockClear()
    errorSpy.mockClear()
    expect(
      await run(['logs', dir, '--output', 'json', '--level', 'error'])
    ).toBe(0)

    expect(printedLines().map((l) => JSON.parse(l))).toEqual([EVENTS[3]])
    expect(errorLines().join('\n')).toContain('4211 event(s) dropped')

    logSpy.mockClear()
    errorSpy.mockClear()
    expect(
      await run(['logs', dir, '--output', 'pretty', '--level', 'error'])
    ).toBe(0)

    expect(printedLines()).toHaveLength(1)
    expect(errorLines().join('\n')).toContain('4211 event(s) dropped')

    logSpy.mockClear()
    errorSpy.mockClear()
    expect(
      await run(['logs', dir, '--output', 'ndjson', '--level', 'off'])
    ).toBe(0)

    expect(printedLines()).toEqual([])
    expect(errorLines()).toEqual([])
  })

  it('surfaces a rotation boundary from the generation header', async () => {
    const header = {
      v: 1,
      type: 'header',
      runId: 'r',
      startedAt: '2026-09-05T12:00:00.000Z',
      rotatedFrom: 'r'
    }
    writeLogs([header, EVENTS[3]])

    expect(await run(['logs', dir, '--output', 'pretty'])).toBe(0)
    expect(printedLines()).toHaveLength(1)
    expect(errorLines()).toHaveLength(1)
    expect(errorLines()[0]).toMatch(
      /rotated to .*chromium[\\/]logs\.1\.ndjson at 2026-09-05T12:00:00\.000Z/
    )

    // Under ndjson too: a header is not a log record, so it never lands on
    // stdout where a reader takes every line for one.
    logSpy.mockClear()
    errorSpy.mockClear()
    expect(await run(['logs', dir, '--output', 'ndjson'])).toBe(0)
    expect(printedLines().map((l) => JSON.parse(l))).toEqual([EVENTS[3]])
    expect(errorLines()).toHaveLength(1)
    expect(errorLines()[0]).toMatch(/rotated to .*logs\.1\.ndjson/)
  })

  it('honors an ISO --since by the event clock and refuses a value that is neither', async () => {
    // EVENTS[0] is the header line, so EVENTS[2] is seq 2.
    const at = new Date(EVENTS[2].timestamp as number).toISOString()
    expect(await run(['logs', dir, '--output', 'ndjson', '--since', at])).toBe(
      0
    )

    expect(printedLines().map((l) => JSON.parse(l).seq)).toEqual([3, 4])

    logSpy.mockClear()
    expect(
      await run(['logs', dir, '--output', 'ndjson', '--since', 'yesterday-ish'])
    ).not.toBe(0)

    expect(String(errorSpy.mock.calls.flat().join(' '))).toContain(
      'expects a sequence number or an ISO timestamp'
    )
  })

  it('refuses a non-numeric --tab instead of printing every event', async () => {
    const stdout: string[] = []
    vi.spyOn(fs, 'writeSync').mockImplementation(((
      _fd: number,
      text: string
    ) => {
      stdout.push(String(text))

      return text.length
    }) as never)

    expect(await run(['logs', dir, '--output', 'ndjson', '--tab', 'abc'])).toBe(
      1
    )

    expect(printedLines()).toEqual([])
    expect(String(errorSpy.mock.calls[0][0])).toContain('--tab')
    expect(JSON.parse(stdout[0])).toMatchObject({
      ok: false,
      command: 'logs',
      status: 'usage',
      error: {code: 'E_FLAG_VALUE_INVALID'}
    })
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

  it('warns on stderr that no signals emitter ships in this build', async () => {
    expect(
      await run(['logs', dir, '--output', 'ndjson', '--signals-only'])
    ).toBe(0)

    const warnings = errorSpy.mock.calls.map((call) => String(call[0]))
    expect(
      warnings.filter((w) =>
        w.includes('no signals emitter ships in this build')
      )
    ).toHaveLength(1)

    // stdout stays machine-clean: the warning never lands in the ndjson stream.
    expect(printedLines().every((l) => l.startsWith('{'))).toBe(true)
  })

  it('does not warn about the missing emitter without --signals-only', async () => {
    expect(await run(['logs', dir, '--output', 'ndjson'])).toBe(0)
    const warnings = errorSpy.mock.calls.map((call) => String(call[0]))
    expect(warnings.some((w) => w.includes('no signals emitter'))).toBe(false)
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
