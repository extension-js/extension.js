import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest'

const bridge = {
  ready: {controlPort: 9123, instanceId: 'inst-1'} as unknown,
  token: 'tok-1' as unknown,
  connectError: null as Error | null,
  commandError: null as Error | null,
  result: {ok: true, value: 'v'} as any,
  controllers: [] as any[],
  commands: [] as any[],
  tokenReads: [] as any[],
  sessionReads: [] as string[],
  readyDoc: null as Record<string, unknown> | null
}

// What each failure would send, read here in place of the telemetry sink.
const marks = {failures: [] as Array<Record<string, unknown>>}

import {registerActCommands} from '../commands/act'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

const loadBridge = async () => ({
  readReadyContract: (_projectPath: string, browser: string) => {
    bridge.sessionReads.push(browser)

    return typeof bridge.ready === 'function'
      ? (bridge.ready as (b: string) => unknown)(browser)
      : bridge.ready
  },
  readReadyContractDocument: () => bridge.readyDoc,
  readControlToken: (...args: unknown[]) => {
    bridge.tokenReads.push(args)

    return bridge.token
  },
  BridgeController: class {
    opts: any
    closed = false
    constructor(opts: any) {
      this.opts = opts
      bridge.controllers.push(this)
    }
    async connect() {
      if (bridge.connectError) throw bridge.connectError
    }
    async command(payload: any) {
      bridge.commands.push(payload)
      if (bridge.commandError) throw bridge.commandError

      return bridge.result
    }
    close() {
      this.closed = true
    }
  }
})

let logSpy: MockInstance<typeof console.log>
let errorSpy: MockInstance<typeof console.error>

beforeEach(() => {
  stubProcessExit()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  bridge.ready = {controlPort: 9123, instanceId: 'inst-1'}
  bridge.token = 'tok-1'
  bridge.connectError = null
  bridge.commandError = null
  bridge.result = {ok: true, value: 'v'}
  bridge.controllers = []
  bridge.commands = []
  bridge.tokenReads = []
  bridge.sessionReads = []
  bridge.readyDoc = null
  marks.failures.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function run(argv: string[]) {
  return runCli(
    makeProgram((program) =>
      registerActCommands(program, {
        loadBridge,
        markFailure: (_command, details) => {
          marks.failures.push(details as Record<string, unknown>)
        }
      })
    ),
    argv
  )
}

function printedErrors(): string {
  return errorSpy.mock.calls.map((call) => call.join(' ')).join('\n')
}

// A port something answers on, the only proof a hint has that a session runs.
function listenOnLoopback(): Promise<{port: number; close(): Promise<void>}> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.destroy())

    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () => new Promise<void>((done) => server.close(() => done()))
      })
    )
  })
}

async function silentLoopbackPort(): Promise<number> {
  const server = await listenOnLoopback()
  await server.close()

  return server.port
}

// One exited child serves every test: its pid stays dead for the file.
let exitedPid = 0

function deadPid(): number {
  exitedPid ||= spawnSync(process.execPath, ['-e', '']).pid

  return exitedPid
}

// Every spelling commander accepts for one verb, read from its options.
function registeredFlags(verb: string): string[] {
  const command = makeProgram(registerActCommands).commands.find(
    (candidate) => candidate.name() === verb
  )

  return (command?.options ?? []).flatMap((option) =>
    [option.short, option.long].filter((flag): flag is string => Boolean(flag))
  )
}

interface ForwardingRow {
  argv: string[]
  // The browser whose session and token the run looks up.
  browser?: string
  command: {
    op: string
    target: Record<string, unknown>
    args?: Record<string, unknown>
    timeoutMs?: number
  }
}

const VERBS = ['eval', 'storage', 'reload', 'inspect', 'navigate', 'open']

// The shortest run of each verb and the command the bridge receives for it.
const SHORTEST: Record<string, ForwardingRow> = {
  eval: {
    argv: ['eval', '6*7'],
    command: {
      op: 'eval',
      target: {context: 'background'},
      args: {expression: '6*7'}
    }
  },
  storage: {
    argv: ['storage', 'get'],
    command: {
      op: 'storage.get',
      target: {context: 'background'},
      args: {area: 'local'}
    }
  },
  reload: {
    argv: ['reload'],
    command: {op: 'reload', target: {context: 'background'}, args: undefined}
  },
  inspect: {
    argv: ['inspect'],
    command: {
      op: 'inspect',
      target: {context: 'content'},
      args: {include: ['summary'], maxBytes: undefined}
    }
  },
  navigate: {
    argv: ['navigate', 'https://example.test/page'],
    command: {
      op: 'tabs.navigate',
      target: {context: 'background'},
      args: {url: 'https://example.test/page'}
    }
  },
  open: {
    argv: ['open', 'options'],
    command: {
      op: 'open',
      target: {context: 'options'},
      args: {surface: 'options'}
    }
  }
}

function row(
  verb: string,
  flags: string[],
  change: Partial<ForwardingRow['command']> = {},
  browser?: string
): ForwardingRow {
  const shortest = SHORTEST[verb]

  return {
    argv: [...shortest.argv, ...flags],
    browser,
    command: {...shortest.command, ...change}
  }
}

// Gecko has no gesture gate on the popup, so these still go to the engine.
const GECKO_SURFACES = [
  'firefox',
  'waterfox',
  'zen',
  'floorp',
  'librewolf'
].flatMap((browser) =>
  ['popup', 'sidebar'].map(
    (surface): ForwardingRow => ({
      argv: ['open', surface, '--browser', browser],
      browser,
      command: {op: 'open', target: {context: surface}, args: {surface}}
    })
  )
)

const FORWARDING: ForwardingRow[] = [
  ...VERBS.flatMap((verb) => [
    row(verb, []),
    row(verb, ['--timeout', '250'], {timeoutMs: 250}),
    row(verb, ['--output', 'json']),
    row(verb, ['--output', 'pretty']),
    row(verb, ['--browser', 'edge'], {}, 'edge')
  ]),
  row('eval', ['--context', 'content', '--url', '*example*', '--tab', '7'], {
    target: {context: 'content', url: '*example*', tabId: 7}
  }),
  row('eval', ['--context', 'popup'], {target: {context: 'popup'}}),
  row('storage', ['--area', 'sync', '--key', 'theme'], {
    args: {area: 'sync', key: 'theme'}
  }),
  row('storage', ['--context', 'popup'], {target: {context: 'popup'}}),
  {
    argv: ['storage', 'set', '--key', 'count', '--value', '3'],
    command: {
      op: 'storage.set',
      target: {context: 'background'},
      args: {area: 'local', items: {count: 3}}
    }
  },
  {
    // A value that is not JSON is stored as the string it is.
    argv: ['storage', 'set', '--key', 'name', '--value', 'not json {'],
    command: {
      op: 'storage.set',
      target: {context: 'background'},
      args: {area: 'local', items: {name: 'not json {'}}
    }
  },
  // --url is resolved to its tab in the runtime, so no tabId goes out.
  row('reload', ['--context', 'content', '--url', '*shop*'], {
    target: {context: 'content', url: '*shop*'}
  }),
  row('reload', ['--context', 'page', '--tab', '3'], {
    target: {context: 'page', tabId: 3}
  }),
  row('inspect', ['--include', 'html, summary', '--max-bytes', '1024'], {
    args: {include: ['html', 'summary'], maxBytes: 1024}
  }),
  row('inspect', ['--context', 'popup'], {target: {context: 'popup'}}),
  row('inspect', ['--url', '*example*', '--tab', '7'], {
    target: {context: 'content', url: '*example*', tabId: 7}
  }),
  // Console lines are read after the bridge answers, so nothing is sent.
  row('inspect', ['--with-console']),
  row('inspect', ['--with-console', '5']),
  row('inspect', ['--list-tabs'], {
    op: 'tabs.query',
    target: {context: 'background'},
    args: {}
  }),
  row('navigate', ['--tab', '12'], {
    target: {context: 'background', tabId: 12}
  }),
  row('navigate', ['--new-tab'], {
    args: {url: 'https://example.test/page', newTab: true}
  }),
  row('navigate', ['--new-tab', '--background'], {
    args: {url: 'https://example.test/page', newTab: true, active: false}
  }),
  // action and command replay a captured event in the service worker.
  {
    argv: ['open', 'action'],
    command: {
      op: 'open',
      target: {context: 'background'},
      args: {surface: 'action'}
    }
  },
  {
    argv: ['open', 'command', '--name', 'toggle-panel'],
    command: {
      op: 'open',
      target: {context: 'background'},
      args: {surface: 'command', name: 'toggle-panel'}
    }
  },
  {
    argv: ['open', 'command'],
    command: {
      op: 'open',
      target: {context: 'background'},
      args: {surface: 'command'}
    }
  },
  ...GECKO_SURFACES
]

describe('act flag forwarding', () => {
  it.each(VERBS)('has a row for every flag %s registers', (verb) => {
    const typed = new Set(
      FORWARDING.filter((entry) => entry.argv[0] === verb).flatMap((entry) =>
        entry.argv.filter((arg) => arg.startsWith('--'))
      )
    )

    expect(registeredFlags(verb).filter((flag) => !typed.has(flag))).toEqual([])
  })

  it.each(FORWARDING)('sends the bridge the command of $argv', async ({
    argv,
    browser = 'chromium',
    command
  }) => {
    const isEval = argv[0] === 'eval'

    expect(await run(argv)).toBe(0)
    expect(bridge.commands).toEqual([{timeoutMs: 5000, ...command}])
    expect(bridge.sessionReads).toEqual([browser])
    // Only eval reads the session token, and each verb names its own unlock
    // flag for the refusal a closed channel answers with.
    expect(bridge.tokenReads.map(([, target]) => target)).toEqual(
      isEval ? [browser] : []
    )

    expect(bridge.controllers.map((controller) => controller.opts)).toEqual([
      {
        controlPort: 9123,
        instanceId: 'inst-1',
        token: isEval ? 'tok-1' : undefined,
        unlockFlag: isEval ? '--allow-eval' : '--allow-control'
      }
    ])

    expect(bridge.controllers.map((controller) => controller.closed)).toEqual([
      true
    ])
  })
})

describe('extension eval', () => {
  it('prints the value the bridge answers with', async () => {
    bridge.result = {ok: true, value: '42'}
    expect(await run(['eval', '6*7'])).toBe(0)
    expect(logSpy.mock.calls).toEqual([['42']])
    expect(errorSpy.mock.calls).toEqual([])
  })

  it('prints the value as one schema-1 frame under --output json', async () => {
    bridge.result = {ok: true, value: {answer: 42}}
    expect(await run(['eval', 'location.href', '--output', 'json'])).toBe(0)
    expect(logSpy.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual(
      [
        {
          schema: 1,
          ok: true,
          command: 'eval',
          status: 'ok',
          value: {answer: 42},
          error: null,
          warnings: []
        }
      ]
    )
  })

  it('exits 1 when no control channel is up', async () => {
    bridge.ready = null
    expect(await run(['eval', '1+1'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain(
      'No active control channel'
    )
  })

  it.each([
    ['start', 'eval', '--allow-eval'],
    ['preview', 'reload', '--allow-control']
  ])('answers the receipt of a refused %s run with the reason it recorded', async (command, verb, flag) => {
    bridge.ready = null
    bridge.readyDoc = {
      command,
      controlPort: null,
      status: 'error',
      code: 'extension_load_refused',
      extensionLoadRefusedAt: '2026-11-16T20:32:53.167Z',
      extensionLoadRefusedReason:
        'the manifest declares a shape this browser refuses'
    }

    const stdout = vi.spyOn(fs, 'writeSync').mockImplementation(() => 0)

    expect(
      await run([
        verb,
        ...(verb === 'eval' ? ['1+1'] : []),
        '--browser',
        'chrome',
        '--output',
        'json'
      ])
    ).toBe(1)

    const frame = JSON.parse(String(stdout.mock.calls[0][1]))

    expect(frame.status).toBe('load-refused')
    expect(frame.error.code).toBe('E_EXTENSION_LOAD_REFUSED')
    expect(frame.error.message).toBe(
      `The last extension ${command} run for chrome ended because the ` +
        'browser refused to load the extension: the manifest declares a ' +
        'shape this browser refuses. Fix what the browser names, then run ' +
        `\`extension ${command} --browser=chrome ${flag}\` again.`
    )

    expect(bridge.controllers).toHaveLength(0)
  })

  it('prints the cause a refused receipt recorded beside its reason', async () => {
    bridge.ready = null
    bridge.readyDoc = {
      command: 'preview',
      controlPort: null,
      status: 'error',
      code: 'extension_load_refused',
      extensionLoadRefusedAt: '2026-11-16T20:32:53.167Z',
      extensionLoadRefusedReason: 'Could not install add-on: TypeError',
      extensionLoadRefusedCause:
        'Firefox does not load a manifest_version above 3.'
    }

    const stdout = vi.spyOn(fs, 'writeSync').mockImplementation(() => 0)

    expect(
      await run(['eval', '1+1', '--browser', 'firefox', '--output', 'json'])
    ).toBe(1)

    const frame = JSON.parse(String(stdout.mock.calls[0][1]))

    expect(frame.error.code).toBe('E_EXTENSION_LOAD_REFUSED')
    expect(frame.error.message).toBe(
      'The last extension preview run for firefox ended because the browser ' +
        'refused to load the extension: Could not install add-on: TypeError. ' +
        'Firefox does not load a manifest_version above 3. Fix what the ' +
        'browser names, then run `extension preview --browser=firefox ' +
        '--allow-eval` again.'
    )
  })

  it('keeps the no-session answer for a dev contract and for a receipt with no refusal', async () => {
    for (const readyDoc of [
      {command: 'dev', code: 'extension_load_refused'},
      {command: 'start', status: 'error', code: 'browser_launch_failed'}
    ]) {
      bridge.ready = null
      bridge.readyDoc = readyDoc
      errorSpy.mockClear()

      expect(await run(['eval', '1+1'])).toBe(1)
      expect(String(errorSpy.mock.calls[0][0])).toContain(
        'No active control channel'
      )
    }
  })

  it('names the browser a live session runs for when the default has none', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'act-other-session-'))
    fs.mkdirSync(path.join(project, 'dist', 'extension-js', 'chrome'), {
      recursive: true
    })

    const live = await listenOnLoopback()

    bridge.ready = (browser: string) =>
      browser === 'chrome'
        ? {controlPort: live.port, instanceId: 'inst-1', status: 'ready'}
        : null

    try {
      expect(await run(['storage', 'get', project])).toBe(1)
      expect(String(errorSpy.mock.calls[0][0])).toContain(
        'A session is running for chrome: pass --browser chrome'
      )
    } finally {
      await live.close()
      fs.rmSync(project, {recursive: true, force: true})
    }
  })

  it.each([
    ['stopped with Ctrl+C', 'stopped', process.pid],
    ['killed, its pid gone', 'ready', 0]
  ])('never offers a session that was %s as running', async (_how, status, pid) => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'act-ended-session-'))
    fs.mkdirSync(path.join(project, 'dist', 'extension-js', 'chrome'), {
      recursive: true
    })

    const silentPort = await silentLoopbackPort()

    bridge.ready = (browser: string) =>
      browser === 'chrome'
        ? {
            controlPort: silentPort,
            instanceId: 'inst-1',
            status,
            pid: pid || deadPid()
          }
        : null

    try {
      expect(await run(['eval', '1+1', project, '--browser', 'firefox'])).toBe(
        1
      )

      const printed = String(errorSpy.mock.calls[0][0])

      expect(printed).toContain('No active control channel found for firefox')
      expect(printed).not.toContain('is running')
      expect(printed).not.toContain('--browser chrome')
    } finally {
      fs.rmSync(project, {recursive: true, force: true})
    }
  })

  it.each([
    ['dev', 'The dev session for chrome ended'],
    ['start', 'The extension start session for chrome ended'],
    ['preview', 'The extension preview session for chrome ended']
  ])('answers a stopped %s session with E_SESSION_NOT_FOUND and its own command, without dialing', async (command, opening) => {
    bridge.ready = {
      controlPort: await silentLoopbackPort(),
      instanceId: 'inst-1',
      status: 'stopped',
      command,
      pid: deadPid()
    }

    const stdout = vi.spyOn(fs, 'writeSync').mockImplementation(() => 0)

    expect(
      await run(['eval', '1+1', '--browser', 'chrome', '--output', 'json'])
    ).toBe(1)

    const frame = JSON.parse(String(stdout.mock.calls[0][1]))

    expect(frame.error.code).toBe('E_SESSION_NOT_FOUND')
    expect(frame.error.message).toContain(opening)
    expect(frame.error.message).toContain("reads status 'stopped'")
    expect(frame.error.message).toContain(
      `Run \`extension ${command} --browser=chrome --allow-eval\` to start one.`
    )

    expect(bridge.controllers).toHaveLength(0)
  })

  it.each([
    ['stopped', 'shutdown'],
    ['error', 'extension_load_refused']
  ])('names the refusal a session with status %s ended on, with the refusal code', async (status, code) => {
    bridge.ready = {
      controlPort: await silentLoopbackPort(),
      instanceId: 'inst-1',
      status,
      command: 'dev',
      pid: deadPid()
    }

    bridge.readyDoc = {
      command: 'dev',
      status,
      code,
      extensionLoadRefusedAt: '2026-11-16T22:32:42.533Z',
      extensionLoadRefusedReason:
        'This extension requires Google Chrome for Testing version 999 or greater.'
    }

    const stdout = vi.spyOn(fs, 'writeSync').mockImplementation(() => 0)

    expect(
      await run(['eval', '1+1', '--browser', 'chrome', '--output', 'json'])
    ).toBe(1)

    const frame = JSON.parse(String(stdout.mock.calls[0][1]))

    expect(frame.status).toBe('load-refused')
    expect(frame.error.code).toBe('E_EXTENSION_LOAD_REFUSED')
    expect(frame.error.message).toBe(
      'The dev session for chrome ended after the browser refused to load ' +
        'the extension: This extension requires Google Chrome for Testing ' +
        'version 999 or greater. Fix what the browser names, then run ' +
        '`extension dev --browser=chrome --allow-eval` to start one.'
    )

    expect(bridge.controllers).toHaveLength(0)
  })

  it('answers a killed session, whose contract still reads ready, the same way', async () => {
    const pid = deadPid()

    bridge.ready = {
      controlPort: await silentLoopbackPort(),
      instanceId: 'inst-1',
      status: 'ready',
      command: 'dev',
      pid
    }

    const stdout = vi.spyOn(fs, 'writeSync').mockImplementation(() => 0)

    expect(
      await run(['storage', 'get', '--browser', 'chrome', '--output', 'json'])
    ).toBe(1)

    const frame = JSON.parse(String(stdout.mock.calls[0][1]))

    expect(frame.error.code).toBe('E_SESSION_NOT_FOUND')
    expect(frame.error.message).toContain(`its process (pid ${pid}) is gone`)
    expect(frame.error.message).toContain(
      'Run `extension dev --browser=chrome --allow-control` to start one.'
    )

    expect(frame.error.message).not.toContain('code 1006')
    expect(bridge.controllers).toHaveLength(0)
  })

  it('points a verb aimed at a stopped browser to the one that still runs', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'act-two-sessions-'))

    for (const browser of ['chrome', 'firefox']) {
      fs.mkdirSync(path.join(project, 'dist', 'extension-js', browser), {
        recursive: true
      })
    }

    const live = await listenOnLoopback()
    const silentPort = await silentLoopbackPort()

    bridge.ready = (browser: string) =>
      browser === 'chrome'
        ? {
            controlPort: silentPort,
            instanceId: 'inst-1',
            status: 'stopped',
            command: 'dev',
            pid: deadPid()
          }
        : browser === 'firefox'
          ? {
              controlPort: live.port,
              instanceId: 'inst-2',
              status: 'ready',
              command: 'dev',
              pid: process.pid
            }
          : null

    try {
      expect(await run(['reload', project, '--browser', 'chrome'])).toBe(1)

      const printed = String(errorSpy.mock.calls[0][0])

      expect(printed).toContain('The dev session for chrome ended')
      expect(printed).toContain(
        'A session is running for firefox: pass --browser firefox to use it.'
      )
    } finally {
      await live.close()
      fs.rmSync(project, {recursive: true, force: true})
    }
  })

  it('the no-session remedy for eval names --allow-eval', async () => {
    bridge.ready = null
    expect(await run(['eval', '1+1'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('--allow-eval')
    expect(String(errorSpy.mock.calls[0][0])).not.toContain('--allow-control')
  })

  it('exits 1 when the connect handshake fails', async () => {
    bridge.connectError = new Error('token required')
    expect(await run(['eval', '1+1'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('token required')
  })

  it('exits 1 when the command itself rejects', async () => {
    bridge.commandError = new Error('timed out')
    expect(await run(['eval', '1+1'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('timed out')
    expect(bridge.controllers[0].closed).toBe(true)
  })

  it('prints the bridge error and exits 1 on a not-ok result', async () => {
    bridge.result = {
      ok: false,
      error: {name: 'EvalError', message: 'denied', engine: 'chromium'}
    }

    expect(await run(['eval', '1+1'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toBe(
      'EvalError: denied (engine: chromium)'
    )
  })

  it('names the engine once when the refusal already ends with it', async () => {
    for (const message of [
      'eval is blocked in the extension background. Engine: chromium',
      'sidePanel not available (engine: chromium)'
    ]) {
      errorSpy.mockClear()
      bridge.result = {
        ok: false,
        error: {name: 'Unsupported', message, engine: 'chromium'}
      }

      expect(await run(['eval', '1+1'])).toBe(1)
      expect(String(errorSpy.mock.calls[0][0])).toBe(`Unsupported: ${message}`)
    }
  })

  it('notes byte-cap truncation on stderr', async () => {
    bridge.result = {ok: true, value: 'partial', truncated: true}
    expect(await run(['eval', 'document.body.outerHTML'])).toBe(0)
    expect(String(errorSpy.mock.calls[0][0])).toContain('truncated')
  })
})

describe('numeric flags', () => {
  const stdout: string[] = []

  beforeEach(() => {
    stdout.length = 0
    vi.spyOn(fs, 'writeSync').mockImplementation(((
      _fd: number,
      text: string
    ) => {
      stdout.push(String(text))

      return text.length
    }) as never)
  })

  async function refusal(argv: string[], flag: string) {
    expect(await run([...argv, '--output', 'json'])).toBe(1)
    expect(bridge.controllers).toHaveLength(0)
    expect(bridge.commands).toHaveLength(0)
    expect(errorSpy).not.toHaveBeenCalled()

    const frame = JSON.parse(stdout[0])
    expect(frame.error.message).toContain(flag)

    return frame
  }

  it.each(
    VERBS
  )('answers a refusal on %s with the frame alone under --output json', async (verb) => {
    expect(
      await run([
        ...SHORTEST[verb].argv,
        '--timeout',
        'abc',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(errorSpy).not.toHaveBeenCalled()
    expect(stdout.map((line) => JSON.parse(line))).toEqual([
      {
        schema: 1,
        ok: false,
        command: verb,
        status: 'usage',
        value: null,
        error: {
          code: 'E_FLAG_VALUE_INVALID',
          message: '--timeout expects a positive integer, got: abc',
          name: 'CliError'
        },
        warnings: []
      }
    ])
  })

  it('refuses a non-numeric --timeout before dialing the session', async () => {
    expect(
      await refusal(['eval', '1+1', '--timeout', 'abc'], '--timeout')
    ).toMatchObject({
      ok: false,
      command: 'eval',
      status: 'usage',
      error: {code: 'E_FLAG_VALUE_INVALID'}
    })
  })

  it('refuses a non-numeric --tab instead of falling back to the active tab', async () => {
    expect(
      await refusal(
        ['eval', '1+1', '--context', 'content', '--tab', 'abc'],
        '--tab'
      )
    ).toMatchObject({command: 'eval', error: {code: 'E_FLAG_VALUE_INVALID'}})
  })

  it('refuses a fractional --tab on reload', async () => {
    expect(
      await refusal(['reload', '--context', 'content', '--tab', '1.5'], '--tab')
    ).toMatchObject({command: 'reload', error: {code: 'E_FLAG_VALUE_INVALID'}})
  })

  it('refuses a negative --tab on navigate', async () => {
    expect(
      await refusal(
        ['navigate', 'https://example.test/', '--tab', '-3'],
        '--tab'
      )
    ).toMatchObject({
      command: 'navigate',
      status: 'usage',
      error: {code: 'E_FLAG_VALUE_INVALID'}
    })
  })

  it('refuses a non-numeric --max-bytes on inspect', async () => {
    expect(
      await refusal(['inspect', '--max-bytes', 'abc'], '--max-bytes')
    ).toMatchObject({command: 'inspect', error: {code: 'E_FLAG_VALUE_INVALID'}})
  })

  it('refuses a negative --timeout in pretty mode too', async () => {
    expect(await run(['eval', '1+1', '--timeout', '-5'])).toBe(1)
    expect(bridge.commands).toHaveLength(0)
    expect(String(errorSpy.mock.calls[0][0])).toContain('--timeout')
  })
})

describe('extension storage', () => {
  it('the no-session remedy for a bounded verb names --allow-control', async () => {
    bridge.ready = null
    expect(await run(['storage', 'get'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('--allow-control')
    expect(String(errorSpy.mock.calls[0][0])).not.toContain('--allow-eval')
  })

  it('requires --key and --value for set', async () => {
    expect(await run(['storage', 'set', '--key', 'only'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain(
      'requires --key and --value'
    )
  })

  it('rejects unknown actions', async () => {
    expect(await run(['storage', 'drop'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain(
      'unknown storage action'
    )
  })
})

describe('extension inspect', () => {
  it('clamps a --max-bytes no result can carry and says so', async () => {
    bridge.result = {ok: true, value: {summary: {htmlLength: 10}, html: 'x'}}
    expect(
      await run(['inspect', '--include', 'html', '--max-bytes', '2000000'])
    ).toBe(0)

    expect(bridge.commands[0].args.maxBytes).toBe(262144)
    expect(errorSpy).toHaveBeenCalledWith(
      '… --max-bytes 2000000 is above the 262144 bytes one result can carry, so 262144 was used'
    )
  })

  it('marks html cut at the result cap as truncated and says where', async () => {
    bridge.result = {
      ok: true,
      value: {
        summary: {htmlLength: 350000},
        html: 'x'.repeat(250000),
        htmlTruncated: true
      }
    }

    expect(
      await run(['inspect', '--include', 'html', '--output', 'json'])
    ).toBe(0)

    const frame = JSON.parse(String(logSpy.mock.calls[0][0]))

    expect(frame.truncated).toBe(true)
    expect(frame.value.html).toHaveLength(250000)
    expect(frame.warnings).toEqual([
      'html cut to 250000 of 350000 characters to fit the 262144-byte result cap. ' +
        'Read on with eval: document.documentElement.outerHTML.slice(250000, 450000)'
    ])
  })

  it('names --max-bytes when the flag made the cut', async () => {
    bridge.result = {
      ok: true,
      value: {
        summary: {htmlLength: 350000},
        html: 'x'.repeat(1024),
        htmlTruncated: true
      }
    }

    expect(
      await run(['inspect', '--include', 'html', '--max-bytes', '1024'])
    ).toBe(0)

    expect(errorSpy).toHaveBeenCalledWith(
      '… html cut to 1024 of 350000 characters by --max-bytes'
    )

    expect(errorSpy).not.toHaveBeenCalledWith('… result truncated (byte cap)')
  })

  it('augments the result with recent console lines via --with-console', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-act-'))

    try {
      const out = path.join(dir, 'dist', 'extension-js', 'chromium')
      fs.mkdirSync(out, {recursive: true})
      fs.writeFileSync(
        path.join(out, 'logs.ndjson'),
        [
          JSON.stringify({
            seq: 1,
            level: 'log',
            context: 'content',
            messageParts: ['hi']
          }),
          JSON.stringify({
            seq: 2,
            level: 'warn',
            context: 'content',
            messageParts: ['yo']
          })
        ].join('\n'),
        'utf8'
      )

      bridge.result = {ok: true, value: {summary: {}}}
      expect(
        await run(['inspect', dir, '--with-console', '1', '--output', 'json'])
      ).toBe(0)

      const printed = JSON.parse(String(logSpy.mock.calls[0][0]))
      expect(printed.console).toHaveLength(1)
      expect(printed.console[0]).toMatchObject({seq: 2, level: 'warn'})
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })
})

describe('extension open', () => {
  it('still refuses the popup before the bridge on a chromium fork', async () => {
    for (const browser of ['chrome', 'brave', 'vivaldi']) {
      bridge.commands = []
      errorSpy.mockClear()
      expect(await run(['open', 'popup', '--browser', browser])).toBe(1)
      expect(String(errorSpy.mock.calls[0][0]), browser).toContain(
        'user gesture'
      )

      expect(bridge.commands, browser).toHaveLength(0)
    }
  })

  it('refuses options before the bridge when the manifest declares no options page', async () => {
    const distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'act-no-options-'))
    fs.writeFileSync(
      path.join(distPath, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'x', version: '1'})
    )

    bridge.readyDoc = {distPath}
    const stdout: string[] = []
    vi.spyOn(fs, 'writeSync').mockImplementation(((
      _fd: number,
      text: string
    ) => {
      stdout.push(String(text))

      return text.length
    }) as never)

    try {
      expect(await run(['open', 'options', '--output', 'json'])).toBe(1)
      expect(bridge.commands).toHaveLength(0)
      expect(JSON.parse(stdout[0])).toMatchObject({
        ok: false,
        status: 'not-found',
        error: {
          code: 'E_TARGET_NOT_FOUND',
          message: expect.stringContaining('options_ui'),
          hint: expect.stringContaining('options_ui')
        }
      })

      // A prefixed key still declares the page, so the engine is asked.
      fs.writeFileSync(
        path.join(distPath, 'manifest.json'),
        JSON.stringify({'chromium:options_ui': {page: 'options.html'}})
      )

      logSpy.mockClear()
      expect(await run(['open', 'options'])).toBe(0)
      expect(bridge.commands).toHaveLength(1)
    } finally {
      fs.rmSync(distPath, {recursive: true, force: true})
    }
  })

  it('reports the engine refusing an undeclared options page as not-found', async () => {
    bridge.result = {
      ok: false,
      error: {
        name: 'Unsupported',
        message:
          'openOptionsPage: Could not create an options page. (the manifest declares no options_ui or options_page)',
        engine: 'chromium',
        code: 'surface_not_declared'
      }
    }

    expect(await run(['open', 'options', '--output', 'json'])).toBe(1)
    expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toMatchObject({
      ok: false,
      status: 'not-found',
      error: {
        code: 'E_TARGET_NOT_FOUND',
        hint: expect.stringContaining('options_ui')
      }
    })
  })

  it('rejects unknown surfaces', async () => {
    expect(await run(['open', 'window'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('unknown surface')
  })

  it.each([
    [
      ['navigate', 'https://example.test/page', '--background'],
      'navigate',
      '--background applies only with --new-tab. Add --new-tab, or drop --background.'
    ],
    [
      ['open', 'popup', '--name', 'toggle-panel'],
      'open',
      '--name applies only to open command (got open popup). Drop --name, or run extension open command --name toggle-panel.'
    ]
  ])('refuses %j as a usage error before touching the bridge', async (argv, command, message) => {
    const stdout = vi.spyOn(fs, 'writeSync').mockImplementation(() => 0)

    expect(await run([...argv, '--output', 'json'])).toBe(1)
    expect(bridge.commands).toHaveLength(0)
    expect(JSON.parse(String(stdout.mock.calls[0][1]))).toEqual({
      schema: 1,
      ok: false,
      command,
      status: 'usage',
      value: null,
      error: {code: 'E_ARGS', message, name: 'CliError'},
      warnings: []
    })
  })

  it('refuses a relative url before touching the bridge', async () => {
    expect(await run(['navigate', 'example.test/page'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('absolute url')
    expect(bridge.commands).toHaveLength(0)
  })

  it('says where it navigated instead of printing the result object', async () => {
    bridge.result = {
      ok: true,
      value: {tabId: 7, url: 'https://example.test/page', created: false}
    }

    expect(await run(['navigate', 'https://example.test/page'])).toBe(0)
    expect(logSpy.mock.calls.map((c) => String(c[0]))).toEqual([
      '⏵⏵⏵ Navigated tab 7 to https://example.test/page'
    ])
  })

  it('reports a url the engine refuses as a usage error with the rule spelled out', async () => {
    // Firefox refuses privileged about: urls from its tabs API. That is the
    // caller's url, so it must not read as E_INTERNAL (our fault).
    bridge.result = {
      ok: false,
      error: {
        name: 'BadRequest',
        message:
          "firefox refuses to open about:newtab from the extension's tabs API (Illegal URL: about:newtab)",
        engine: 'firefox',
        code: 'url_refused'
      }
    }

    expect(
      await run([
        'navigate',
        'about:newtab',
        '--new-tab',
        '--browser',
        'firefox'
      ])
    ).toBe(1)

    const printed = String(errorSpy.mock.calls[0][0])
    expect(printed).toContain("Can't navigate a tab to about:newtab")
    expect(printed).toContain('Illegal URL: about:newtab')
    expect(printed).toContain('Only web urls and about:blank open this way')
    // The reason opens with the engine, so it is not appended a second time.
    expect(printedErrors().match(/firefox/g)).toHaveLength(1)

    errorSpy.mockClear()
    logSpy.mockClear()
    expect(
      await run([
        'navigate',
        'about:newtab',
        '--new-tab',
        '--browser',
        'firefox',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toMatchObject({
      ok: false,
      command: 'navigate',
      status: 'usage',
      error: {
        code: 'E_ARGS',
        name: 'BadRequest',
        engine: 'firefox',
        hint: expect.stringContaining('about:blank')
      }
    })
  })

  it('gives Chromium its own remedy for a refused url', async () => {
    // The Firefox hint talks about about: pages, which is wrong for Chromium,
    // where the one refused scheme is javascript: and eval is the way in.
    bridge.result = {
      ok: false,
      error: {
        name: 'BadRequest',
        message:
          "chromium refuses to open javascript:alert(1) from the extension's tabs API (JavaScript URLs are not allowed in API based extension navigations. Use chrome.scripting.executeScript instead.)",
        engine: 'chromium',
        code: 'url_refused'
      }
    }

    expect(
      await run(['navigate', 'javascript:alert(1)', '--output', 'json'])
    ).toBe(1)

    const printed = JSON.parse(String(logSpy.mock.calls[0][0]))

    expect(printed.error.code).toBe('E_ARGS')
    expect(printed.error.hint).toContain('eval --context content')
    expect(printed.error.hint).not.toContain('about:newtab')
  })

  it('refuses a surface context for reload before touching the bridge', async () => {
    expect(await run(['reload', '--context', 'popup'])).toBe(1)
    expect(errorSpy.mock.calls.map((call) => String(call[0]))).toEqual([
      '⏵⏵⏵ --context got "popup". Use background, content or page.\n' +
        'A popup page reloads with the extension: run extension reload without --context.'
    ])

    expect(bridge.commands).toHaveLength(0)

    errorSpy.mockClear()
    expect(await run(['reload', '--context', 'nowhere'])).toBe(1)
    expect(errorSpy.mock.calls.map((call) => String(call[0]))).toEqual([
      '⏵⏵⏵ --context got "nowhere". Use background, content or page.'
    ])

    expect(bridge.commands).toHaveLength(0)
  })

  it('reports a missing tab as not-found with the list-tabs hint', async () => {
    bridge.result = {
      ok: false,
      error: {
        name: 'TargetNotFound',
        message: 'No tab with id: 999999.',
        engine: 'chromium',
        code: 'tab_not_found'
      }
    }

    expect(
      await run([
        'navigate',
        'https://example.test/',
        '--tab',
        '999999',
        '--output',
        'json'
      ])
    ).toBe(1)

    expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toMatchObject({
      ok: false,
      status: 'not-found',
      error: {
        code: 'E_TARGET_NOT_FOUND',
        hint: expect.stringContaining('--list-tabs')
      }
    })
  })

  it('says what opened instead of printing the result object', async () => {
    bridge.result = {ok: true, value: {opened: 'popup'}}
    expect(await run(['open', 'popup', '--browser', 'firefox'])).toBe(0)
    expect(logSpy.mock.calls.map((c) => String(c[0]))).toEqual([
      '⏵⏵⏵ Opened the popup.'
    ])

    logSpy.mockClear()
    bridge.result = {ok: true, value: {opened: 'options'}}
    expect(await run(['open', 'options'])).toBe(0)
    expect(String(logSpy.mock.calls[0][0])).toBe('⏵⏵⏵ Opened the options page.')

    logSpy.mockClear()
    bridge.result = {ok: true, value: {triggered: 'popup'}}
    expect(await run(['open', 'action'])).toBe(0)
    expect(String(logSpy.mock.calls[0][0])).toBe('⏵⏵⏵ Opened the action popup.')
  })

  it('counts replayed listeners and prints the warning on its own line', async () => {
    bridge.result = {
      ok: true,
      value: {
        triggered: 'onClicked',
        listeners: 1,
        gesture: false,
        warning: 'replayed without a user gesture: activeTab is NOT granted'
      }
    }

    expect(await run(['open', 'action'])).toBe(0)
    expect(logSpy.mock.calls.map((c) => String(c[0]))).toEqual([
      '⏵⏵⏵ Replayed 1 onClicked listener without a user gesture.',
      '⏵⏵⏵ Replayed without a user gesture: activeTab is NOT granted.'
    ])

    logSpy.mockClear()
    bridge.result = {
      ok: true,
      value: {
        triggered: 'command',
        command: 'toggle-panel',
        listeners: 2,
        gesture: false
      }
    }

    expect(await run(['open', 'command', '--name', 'toggle-panel'])).toBe(0)
    expect(logSpy.mock.calls.map((c) => String(c[0]))).toEqual([
      '⏵⏵⏵ Replayed 2 onCommand listeners for toggle-panel without a user gesture.'
    ])
  })

  it('names the manifest key the action replay used', async () => {
    bridge.result = {
      ok: true,
      value: {
        triggered: 'onClicked',
        listeners: 1,
        gesture: false,
        manifestKey: 'browser_action'
      }
    }

    expect(await run(['open', 'action'])).toBe(0)
    expect(String(logSpy.mock.calls[0][0])).toBe(
      '⏵⏵⏵ Replayed 1 browser_action onClicked listener without a user gesture.'
    )

    logSpy.mockClear()
    bridge.result = {
      ok: true,
      value: {triggered: 'popup', manifestKey: 'page_action'}
    }

    expect(await run(['open', 'action'])).toBe(0)
    expect(String(logSpy.mock.calls[0][0])).toBe(
      '⏵⏵⏵ Opened the page_action popup.'
    )
  })

  it('keeps the json envelope and unknown result shapes unchanged', async () => {
    const value = {triggered: 'onClicked', listeners: 1, gesture: false}
    bridge.result = {ok: true, value}
    expect(await run(['open', 'action', '--output', 'json'])).toBe(0)
    expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
      schema: 1,
      ok: true,
      command: 'open',
      status: 'ok',
      value,
      error: null,
      warnings: []
    })

    logSpy.mockClear()
    bridge.result = {ok: true, value: {something: 'else'}}
    expect(await run(['open', 'options'])).toBe(0)
    expect(String(logSpy.mock.calls[0][0])).toBe(
      JSON.stringify({something: 'else'}, null, 2)
    )
  })

  it('renders an engine failure as a label line with its reason and remedy', async () => {
    bridge.result = {
      ok: false,
      error: {
        name: 'Unsupported',
        message: 'openPopup: Could not find an active browser window.',
        engine: 'chromium'
      }
    }

    expect(await run(['open', 'popup', '--browser', 'firefox'])).toBe(1)
    const text = String(errorSpy.mock.calls[0][0])
    expect(text).toContain("⏵⏵⏵ Can't open the popup.")
    expect(text).toContain(
      'REASON openPopup: Could not find an active browser window.'
    )

    expect(text).toContain('engine chromium')
    expect(text).not.toContain('Unsupported:')

    errorSpy.mockClear()
    bridge.result = {
      ok: false,
      error: {
        name: 'Unsupported',
        message:
          'sidePanel.open: sidePanel.open() may only be called in response to a user gesture.',
        code: 'needs_user_gesture'
      }
    }

    expect(await run(['open', 'sidebar', '--browser', 'firefox'])).toBe(1)
    const gated = String(errorSpy.mock.calls[0][0]).split('\n')
    expect(gated[0]).toBe("⏵⏵⏵ Can't open the side panel.")
    expect(gated[1]).toContain('REASON sidePanel.open:')
    expect(gated[2]).toContain('Click the extension in the browser toolbar')
  })
})

describe('a failed eval names its cause in telemetry', () => {
  it('marks the guest throw as E_EVAL before exiting', async () => {
    bridge.result = {ok: false, error: {name: 'EvalError', message: 'boom'}}

    expect(await run(['eval', 'boom()'])).toBe(1)

    expect(marks.failures).toEqual([{code: 'E_EVAL', exitCode: 1}])
  })

  it('marks a refused eval with the refusal code', async () => {
    bridge.result = {
      ok: false,
      error: {name: 'EvalDisabled', message: 'eval is off'}
    }

    expect(await run(['eval', '1'])).toBe(1)

    expect(marks.failures).toEqual([{code: 'E_EVAL_REFUSED', exitCode: 1}])
  })

  it('marks nothing when the eval succeeds', async () => {
    bridge.result = {ok: true, value: 2}

    expect(await run(['eval', '1+1'])).toBe(0)

    expect(marks.failures).toEqual([])
  })
})

describe('a failed act verb prints its hint on the human channel', () => {
  it('prints the CSP hint under a refused eval', async () => {
    bridge.result = {
      ok: false,
      error: {
        name: 'EvalError',
        message:
          "Refused to evaluate a string as JavaScript because 'unsafe-eval' is not allowed"
      }
    }

    expect(await run(['eval', '1'])).toBe(1)

    expect(printedErrors()).toContain('EvalError: Refused to evaluate')
    expect(printedErrors()).toContain('extension inspect --context')
  })

  it('prints a hint the bridge supplied for any verb', async () => {
    bridge.result = {
      ok: false,
      error: {
        name: 'StorageError',
        message: 'quota exceeded',
        hint: 'Clear the area with extension storage clear first.'
      }
    }

    expect(await run(['storage', 'get', '--area', 'local'])).toBe(1)

    expect(printedErrors()).toContain(
      'Clear the area with extension storage clear first.'
    )
  })
})
