import fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {WebSocketServer} from 'ws'

// Two refusals that used to send the reader somewhere useless.
//
// `open sidebar`, `open popup` and `open action` reached the browser and only
// then learned that Chromium opens those surfaces on a click alone. The CLI
// now says so before dialing anything. And a 4003 close used to answer "is the
// session started with --allow-control?" to a caller who had passed it, when
// the code means the session itself has control off.
const bridge = {
  ready: {controlPort: 9123, instanceId: 'inst-1'} as unknown,
  document: null as Record<string, unknown> | null,
  connectError: null as Error | null,
  result: {ok: true, value: 'v'} as Record<string, unknown>,
  controllers: [] as Array<{opts: unknown; closed: boolean}>,
  commands: [] as Array<Record<string, unknown>>
}

vi.mock('../helpers/extension-develop-runtime', () => ({
  loadExtensionDevelopBridgeModule: vi.fn(async () => ({
    readReadyContract: () => bridge.ready,
    readReadyContractDocument: () => bridge.document,
    readControlToken: () => 'tok-1',
    BridgeController: class {
      opts: unknown
      closed = false
      constructor(opts: unknown) {
        this.opts = opts
        bridge.controllers.push(this)
      }
      async connect() {
        if (bridge.connectError) throw bridge.connectError
      }
      async command(payload: Record<string, unknown>) {
        bridge.commands.push(payload)
        return bridge.result
      }
      close() {
        this.closed = true
      }
    }
  }))
}))

import {BridgeController} from '../../develop/dev-server/control-bridge/controller-client'
import {registerActCommands} from '../commands/act'
import {makeProgram, runCli, stubProcessExit} from './command-harness'

let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>
const stdout: string[] = []

beforeEach(() => {
  stubProcessExit()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  // fail() writes its json frame straight to fd 1.
  stdout.length = 0
  vi.spyOn(fs, 'writeSync').mockImplementation(((_fd: number, text: string) => {
    stdout.push(String(text))
    return text.length
  }) as never)
  bridge.ready = {controlPort: 9123, instanceId: 'inst-1'}
  bridge.document = null
  bridge.connectError = null
  bridge.result = {ok: true, value: 'v'}
  bridge.controllers = []
  bridge.commands = []
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function run(argv: string[]) {
  return runCli(makeProgram(registerActCommands), argv)
}

function stderr(): string {
  return errorSpy.mock.calls.map((call) => String(call[0])).join('\n')
}

function frame(): Record<string, unknown> {
  expect(stdout).toHaveLength(1)
  return JSON.parse(stdout[0])
}

function projectWithManifest(manifest: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-open-'))
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
  return dir
}

describe('open refuses gesture-gated surfaces before connecting', () => {
  it('sidebar on Chromium is refused with the rule and the manual step', async () => {
    expect(await run(['open', 'sidebar'])).toBe(1)
    expect(bridge.controllers).toHaveLength(0)
    expect(bridge.commands).toHaveLength(0)
    const text = stderr()
    expect(text).toContain(
      'Chromium opens the side panel only in response to a user gesture'
    )
    expect(text).toContain('toolbar entry')
    expect(text).not.toContain(
      'may only be called in response to a user gesture'
    )
  })

  it('popup on Chromium answers a json envelope with the gesture code and a hint', async () => {
    expect(await run(['open', 'popup', '--output', 'json'])).toBe(1)
    expect(bridge.controllers).toHaveLength(0)
    const envelope = frame()
    expect(envelope).toMatchObject({
      schema: 1,
      ok: false,
      command: 'open',
      status: 'failed',
      value: null
    })
    const error = envelope.error as Record<string, unknown>
    expect(error.code).toBe('E_USER_GESTURE_REQUIRED')
    expect(error.name).toBe('CliError')
    expect(String(error.message)).toContain('user gesture')
    // The envelope copy carries no terminal glyph or color.
    expect(String(error.message)).not.toContain('⏵')
    expect(String(error.message)).not.toContain('[')
    expect(String(error.hint)).toContain('toolbar entry')
  })

  it('the refusal wins even when no session is up', async () => {
    bridge.ready = null
    expect(await run(['open', 'sidebar'])).toBe(1)
    expect(stderr()).toContain('user gesture')
    expect(stderr()).not.toContain('No active control channel')
  })

  it('edge and chrome are Chromium too', async () => {
    expect(await run(['open', 'popup', '--browser', 'edge'])).toBe(1)
    expect(await run(['open', 'popup', '--browser', 'chrome'])).toBe(1)
    expect(bridge.controllers).toHaveLength(0)
  })

  it('action is refused only when the manifest declares a popup', async () => {
    const withPopup = projectWithManifest({
      manifest_version: 3,
      action: {default_popup: 'popup.html'}
    })
    const withoutPopup = projectWithManifest({manifest_version: 3, action: {}})
    const prefixed = projectWithManifest({
      manifest_version: 3,
      'chromium:action': {default_popup: 'popup.html'}
    })
    try {
      expect(await run(['open', 'action', withPopup])).toBe(1)
      expect(stderr()).toContain('action popup')
      expect(bridge.controllers).toHaveLength(0)

      expect(await run(['open', 'action', prefixed])).toBe(1)
      expect(bridge.controllers).toHaveLength(0)

      // Without a popup the verb replays onClicked, which no gesture guards.
      expect(await run(['open', 'action', withoutPopup])).toBe(0)
      expect(bridge.commands[0]).toMatchObject({
        op: 'open',
        target: {context: 'background'},
        args: {surface: 'action'}
      })
    } finally {
      for (const dir of [withPopup, withoutPopup, prefixed]) {
        fs.rmSync(dir, {recursive: true, force: true})
      }
    }
  })

  it('action reads the emitted manifest the session names first', async () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-open-dist-'))
    const project = projectWithManifest({manifest_version: 3, action: {}})
    fs.writeFileSync(
      path.join(dist, 'manifest.json'),
      JSON.stringify({manifest_version: 3, action: {default_popup: 'p.html'}})
    )
    bridge.document = {distPath: dist}
    try {
      expect(await run(['open', 'action', project])).toBe(1)
      expect(stderr()).toContain('user gesture')
    } finally {
      fs.rmSync(dist, {recursive: true, force: true})
      fs.rmSync(project, {recursive: true, force: true})
    }
  })

  it('firefox surfaces go to the engine, which answers for itself', async () => {
    expect(await run(['open', 'sidebar', '--browser', 'firefox'])).toBe(0)
    expect(await run(['open', 'popup', '--browser', 'firefox'])).toBe(0)
    expect(bridge.controllers).toHaveLength(2)
    expect(
      bridge.commands.map((c) => (c.args as {surface: string}).surface)
    ).toEqual(['sidebar', 'popup'])
  })

  it('options and command need no gesture and still connect', async () => {
    expect(await run(['open', 'options'])).toBe(0)
    expect(await run(['open', 'command', '--name', 'toggle'])).toBe(0)
    expect(bridge.controllers).toHaveLength(2)
  })

  it('a gesture refusal from the engine still carries the manual step', async () => {
    bridge.result = {
      ok: false,
      error: {
        name: 'Unsupported',
        message: 'sidePanel.open: needs a user gesture',
        code: 'needs_user_gesture',
        engine: 'chromium'
      }
    }
    expect(
      await run(['open', 'sidebar', '--browser', 'firefox', '--output', 'json'])
    ).toBe(1)
    const printed = JSON.parse(String(logSpy.mock.calls[0][0]))
    expect(printed.error.code).toBe('E_USER_GESTURE_REQUIRED')
    expect(printed.error.hint).toContain('toolbar')
  })
})

describe('a 4003 close names the real cause', () => {
  const refusal =
    'control channel refused the controller (code 4003: control channel not available). control is off in the session that answered.'

  it('open against a session with control off says so, without blaming a flag', async () => {
    bridge.connectError = Object.assign(new Error(refusal), {closeCode: 4003})
    expect(await run(['open', 'options'])).toBe(1)
    const text = stderr()
    expect(text).toContain('control is off in that session')
    expect(text).toContain('port 9123')
    expect(text).toContain('extension doctor')
    expect(text).not.toContain('is the session started with')
    expect(text).not.toContain('not started with')
    expect(bridge.controllers[0].closed).toBe(true)
  })

  it('the json envelope carries the denial code and the plain copy', async () => {
    bridge.connectError = Object.assign(new Error(refusal), {closeCode: 4003})
    expect(await run(['open', 'options', '--output', 'json'])).toBe(1)
    const envelope = frame()
    expect(envelope).toMatchObject({
      ok: false,
      command: 'open',
      status: 'denied'
    })
    const error = envelope.error as Record<string, unknown>
    expect(error.code).toBe('E_CONTROL_DENIED')
    expect(String(error.message)).toContain('control is off in that session')
    expect(String(error.message)).toContain('--allow-control')
    expect(String(error.message)).not.toContain('[')
  })

  it('an older client without closeCode is recognised by the code in its message', async () => {
    bridge.connectError = new Error(refusal)
    expect(await run(['storage', 'get'])).toBe(1)
    expect(stderr()).toContain('control is off in that session')
  })

  it('eval names --allow-eval as the flag that turns control on', async () => {
    bridge.connectError = Object.assign(new Error(refusal), {closeCode: 4003})
    expect(await run(['eval', '1+1'])).toBe(1)
    expect(stderr()).toContain('--allow-eval')
    expect(stderr()).not.toContain('--allow-control')
  })

  it('other close codes keep their own cause', async () => {
    bridge.connectError = Object.assign(
      new Error(
        'control channel refused the controller (code 4001: instanceId mismatch). the session that wrote ready.json has been replaced.'
      ),
      {closeCode: 4001}
    )
    expect(await run(['open', 'options', '--output', 'json'])).toBe(1)
    expect(stderr()).toContain('has been replaced')
    expect(stderr()).not.toContain('control is off')
    expect((frame().error as Record<string, unknown>).code).toBe(
      'E_CONTROL_DENIED'
    )
  })
})

describe('the controller client states each close code as a cause', () => {
  async function refuse(
    code: number,
    reason: string
  ): Promise<Error & {closeCode?: number}> {
    const server = new WebSocketServer({port: 0, path: '/extjs-control'})
    await new Promise<void>((resolve) => server.once('listening', resolve))
    server.on('connection', (socket) => {
      socket.once('message', () => socket.close(code, reason))
    })
    const port = (server.address() as {port: number}).port
    const controller = new BridgeController({
      controlPort: port,
      instanceId: 'inst-1',
      connectTimeoutMs: 2000
    })
    try {
      await controller.connect()
      throw new Error('connect resolved')
    } catch (err) {
      return err as Error & {closeCode?: number}
    } finally {
      controller.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  it('4003 says control is off in the session, and tags the code', async () => {
    const err = await refuse(4003, 'control channel not available')
    expect(err.closeCode).toBe(4003)
    expect(err.message).toContain('code 4003')
    expect(err.message).toContain('control is off in the session that answered')
    expect(err.message).toContain('extension doctor')
    expect(err.message).not.toContain('is the session started with')
    expect(err.message).not.toContain(';')
  })

  it('4001 says the session was replaced', async () => {
    const err = await refuse(4001, 'instanceId mismatch')
    expect(err.closeCode).toBe(4001)
    expect(err.message).toContain('has been replaced')
    expect(err.message).not.toContain('--allow-control')
  })
})
