import {describe, it, expect, afterEach, beforeEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {WebSocket} from 'ws'
import {BridgeController} from '../controller-client'
import {startControlServer, type ControlServer} from '../ws-control-server'
import {BridgeBroker} from '../broker'
import {ActionsFileWriter} from '../actions-file'
import {CONTROL_WS_PATH} from '../contracts'
import {
  writeControlToken,
  readControlToken,
  clearControlToken,
  controlTokenPath
} from '../session-token'

/**
 * A fake in-bundle executor: connects as a producer, answers `command` frames
 * with a `result`. Stands in for the browser-side executor (Slice 2 #4) so the
 * Node control path is fully testable without a live browser.
 */
function startFakeExecutor(
  port: number,
  reply: (cmd: any) => any = (cmd) => ({ok: true, value: {echoed: cmd.op}})
): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${CONTROL_WS_PATH}`)
    ws.on('open', () => {
      ws.send(JSON.stringify({type: 'hello', v: 1, role: 'producer', instanceId: 'inst-1'}))
      resolve(ws)
    })
    ws.on('message', (data) => {
      let frame: any
      try {
        frame = JSON.parse(data.toString())
      } catch {
        return
      }
      if (frame.type === 'command') {
        const r = reply(frame)
        ws.send(JSON.stringify({type: 'result', cmdId: frame.cmdId, ...r}))
      }
    })
  })
}

describe('session-token', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-token-'))
  })
  afterEach(() => fs.rmSync(dir, {recursive: true, force: true}))

  it('writes a 0600 token outside dist/ and reads it back', () => {
    const token = writeControlToken(dir)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(readControlToken(dir)).toBe(token)
    const p = controlTokenPath(dir)
    expect(p.includes(`${path.sep}dist${path.sep}`)).toBe(false)
    if (process.platform !== 'win32') {
      expect(fs.statSync(p).mode & 0o777).toBe(0o600)
    }
  })

  it('clears the token and reads null afterward', () => {
    writeControlToken(dir)
    clearControlToken(dir)
    expect(readControlToken(dir)).toBeNull()
  })
})

describe('BridgeController (integration)', () => {
  let server: ControlServer | null = null
  let controller: BridgeController | null = null
  let executor: WebSocket | null = null
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-act-'))
  })
  afterEach(async () => {
    controller?.close()
    controller = null
    try {
      executor?.close()
    } catch {
      // ignore
    }
    executor = null
    if (server) {
      await server.close()
      server = null
    }
    fs.rmSync(dir, {recursive: true, force: true})
  })

  function makeServer(extra: Record<string, unknown> = {}) {
    const broker = new BridgeBroker({
      instanceId: 'inst-1',
      runId: 'run-A',
      engine: 'chromium',
      allowControl: true,
      ...extra
    })
    return broker
  }

  it('connects, negotiates capabilities, and round-trips a command', async () => {
    const broker = makeServer()
    server = await startControlServer({broker})
    executor = await startFakeExecutor(server.port)

    controller = new BridgeController({controlPort: server.port, instanceId: 'inst-1'})
    const ready = await controller.connect()
    expect(ready.capabilities).toMatchObject({storage: true, reload: true})

    const result = await controller.command({op: 'reload', target: {context: 'background'}})
    expect(result).toMatchObject({ok: true, value: {echoed: 'reload'}})
  })

  it('writes an actions.ndjson audit line for a completed command', async () => {
    const actions = new ActionsFileWriter({
      filePath: path.join(dir, 'actions.ndjson')
    })
    const broker = makeServer({actions})
    server = await startControlServer({broker})
    executor = await startFakeExecutor(server.port)

    controller = new BridgeController({controlPort: server.port, instanceId: 'inst-1'})
    await controller.command({op: 'reload', target: {context: 'background'}})

    const lines = fs
      .readFileSync(path.join(dir, 'actions.ndjson'), 'utf-8')
      .split('\n')
      .filter(Boolean)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({v: 1, op: 'reload', ok: true})
  })

  it('eval is forbidden without --allow-eval and a token', async () => {
    const broker = makeServer() // allowControl but not allowEval
    server = await startControlServer({broker})
    executor = await startFakeExecutor(server.port)

    controller = new BridgeController({controlPort: server.port, instanceId: 'inst-1'})
    const result = await controller.command({
      op: 'eval',
      target: {context: 'background'},
      args: {expression: 'chrome.runtime.id'}
    })
    expect(result).toMatchObject({ok: false, error: {name: 'Forbidden'}})
  })

  it('eval succeeds with --allow-eval and the matching token', async () => {
    const token = writeControlToken(dir)
    const broker = makeServer({allowEval: true, controlToken: token})
    server = await startControlServer({broker})
    executor = await startFakeExecutor(server.port, () => ({ok: true, value: 'abc123'}))

    controller = new BridgeController({
      controlPort: server.port,
      instanceId: 'inst-1',
      token: readControlToken(dir) ?? undefined
    })
    const result = await controller.command({
      op: 'eval',
      target: {context: 'background'},
      args: {expression: 'chrome.runtime.id'}
    })
    expect(result).toMatchObject({ok: true, value: 'abc123'})
  })

  it('rejects connect when control is disabled (no --allow-control)', async () => {
    const broker = new BridgeBroker({instanceId: 'inst-1', runId: 'run-A'}) // control off
    server = await startControlServer({broker})
    controller = new BridgeController({controlPort: server.port, instanceId: 'inst-1'})
    await expect(controller.connect()).rejects.toThrow(/refused the controller/)
  })
})
