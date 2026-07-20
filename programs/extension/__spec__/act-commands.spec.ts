import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const bridge = {
  ready: {controlPort: 9123, instanceId: 'inst-1'} as unknown,
  token: 'tok-1' as unknown,
  connectError: null as Error | null,
  commandError: null as Error | null,
  result: {ok: true, value: 'v'} as any,
  controllers: [] as any[],
  commands: [] as any[],
  tokenReads: [] as any[]
}

vi.mock('../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopBridgeModule: vi.fn(async () => ({
    readReadyContract: () => bridge.ready,
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
  }))
}))

import {registerActCommands} from '../commands/act'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

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
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function run(argv: string[]) {
  return runCli(makeProgram(registerActCommands), argv)
}

describe('extension eval', () => {
  it('sends the expression with a session token and prints the value', async () => {
    bridge.result = {ok: true, value: '42'}
    expect(await run(['eval', '6*7'])).toBe(0)
    expect(bridge.tokenReads).toHaveLength(1)
    expect(bridge.controllers[0].opts).toMatchObject({
      controlPort: 9123,
      instanceId: 'inst-1',
      token: 'tok-1'
    })
    expect(bridge.commands[0]).toMatchObject({
      op: 'eval',
      target: {context: 'background'},
      args: {expression: '6*7'},
      timeoutMs: 5000
    })
    expect(logSpy).toHaveBeenCalledWith('42')
    expect(bridge.controllers[0].closed).toBe(true)
  })

  it('targets content by url/tab and honors --timeout and --output json', async () => {
    bridge.result = {ok: true, value: {answer: 42}}
    expect(
      await run([
        'eval',
        'location.href',
        '--context',
        'content',
        '--url',
        '*example*',
        '--tab',
        '7',
        '--timeout',
        '250',
        '--output',
        'json'
      ])
    ).toBe(0)
    expect(bridge.commands[0]).toMatchObject({
      target: {context: 'content', url: '*example*', tabId: 7},
      timeoutMs: 250
    })
    expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
      ok: true,
      value: {answer: 42}
    })
  })

  it('exits 1 when no control channel is up', async () => {
    bridge.ready = null
    expect(await run(['eval', '1+1'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain(
      'No active control channel'
    )
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

  it('notes byte-cap truncation on stderr', async () => {
    bridge.result = {ok: true, value: 'partial', truncated: true}
    expect(await run(['eval', 'document.body.outerHTML'])).toBe(0)
    expect(String(errorSpy.mock.calls[0][0])).toContain('truncated')
  })
})

describe('extension storage', () => {
  it('gets a whole area without a token', async () => {
    expect(await run(['storage', 'get'])).toBe(0)
    expect(bridge.tokenReads).toHaveLength(0)
    expect(bridge.commands[0]).toMatchObject({
      op: 'storage.get',
      args: {area: 'local'}
    })
  })

  it('gets a single key from a chosen area', async () => {
    expect(
      await run(['storage', 'get', '--area', 'sync', '--key', 'theme'])
    ).toBe(0)
    expect(bridge.commands[0].args).toEqual({area: 'sync', key: 'theme'})
  })

  it('sets a JSON value, falling back to a raw string', async () => {
    expect(
      await run(['storage', 'set', '--key', 'count', '--value', '3'])
    ).toBe(0)
    expect(bridge.commands[0]).toMatchObject({
      op: 'storage.set',
      args: {area: 'local', items: {count: 3}}
    })

    bridge.commands = []
    expect(
      await run(['storage', 'set', '--key', 'name', '--value', 'not json {'])
    ).toBe(0)
    expect(bridge.commands[0].args.items).toEqual({name: 'not json {'})
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

describe('extension reload', () => {
  it('reloads the background context by default', async () => {
    expect(await run(['reload'])).toBe(0)
    expect(bridge.commands[0]).toMatchObject({
      op: 'reload',
      target: {context: 'background'}
    })
  })
})

describe('extension inspect', () => {
  it('inspects content with the summary include by default', async () => {
    bridge.result = {ok: true, value: {summary: {}}}
    expect(await run(['inspect'])).toBe(0)
    expect(bridge.commands[0]).toMatchObject({
      op: 'inspect',
      target: {context: 'content'},
      args: {include: ['summary']}
    })
  })

  it('passes --include and --max-bytes through', async () => {
    expect(
      await run([
        'inspect',
        '--include',
        'html, summary',
        '--max-bytes',
        '1024'
      ])
    ).toBe(0)
    expect(bridge.commands[0].args).toEqual({
      include: ['html', 'summary'],
      maxBytes: 1024
    })
  })

  it('lists tabs via tabs.query with --list-tabs', async () => {
    bridge.result = {ok: true, value: [{tabId: 1, url: 'a', title: 't'}]}
    expect(await run(['inspect', '--list-tabs'])).toBe(0)
    expect(bridge.commands[0]).toMatchObject({
      op: 'tabs.query',
      target: {context: 'background'}
    })
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
  it('opens ui surfaces in their own context', async () => {
    expect(await run(['open', 'popup'])).toBe(0)
    expect(bridge.commands[0]).toMatchObject({
      op: 'open',
      target: {context: 'popup'},
      args: {surface: 'popup'}
    })
  })

  it('routes action and command replays to the background', async () => {
    expect(await run(['open', 'action'])).toBe(0)
    expect(bridge.commands[0].target).toEqual({context: 'background'})

    bridge.commands = []
    expect(await run(['open', 'command', '--name', 'toggle-panel'])).toBe(0)
    expect(bridge.commands[0].args).toEqual({
      surface: 'command',
      name: 'toggle-panel'
    })
  })

  it('rejects unknown surfaces', async () => {
    expect(await run(['open', 'window'])).toBe(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain('unknown surface')
  })
})
