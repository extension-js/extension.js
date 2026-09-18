import {afterEach, describe, expect, it} from 'vitest'
import {WebSocket} from 'ws'
import {BridgeBroker} from '../broker'
import {
  CLOSE_BAD_HELLO,
  CLOSE_BAD_INSTANCE,
  CONTROL_WS_PATH
} from '../contracts'
import {
  type ControlServer,
  isAdmittedOrigin,
  startControlServer
} from '../ws-control-server'

const ENGINE = 'https://browsers.extension.land'

let server: ControlServer | null = null
const sockets: WebSocket[] = []

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate()

  if (server) {
    await server.close()
    server = null
  }
})

async function startEmulatorSession(viewerOrigin: string | null = ENGINE) {
  const broker = new BridgeBroker({
    instanceId: 'inst-1',
    runId: 'run-A',
    engine: 'emulator',
    viewerOrigin
  })
  server = await startControlServer({broker, viewerOrigin})

  return broker
}

function dial(origin?: string): WebSocket {
  const ws = new WebSocket(
    `ws://127.0.0.1:${server?.port}${CONTROL_WS_PATH}`,
    origin ? {origin} : {}
  )
  sockets.push(ws)

  return ws
}

function upgradeStatus(ws: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
    ws.on('open', () => reject(new Error('upgrade was accepted')))
    ws.on('error', () => undefined)
  })
}

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })
}

function nextFrame(ws: WebSocket, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no frame')), timeoutMs)
    ws.once('message', (data) => {
      clearTimeout(t)
      resolve(JSON.parse(data.toString()))
    })
  })
}

function closed(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.on('close', (code) => resolve(code)))
}

function hello(role: string, instanceId = 'inst-1') {
  return JSON.stringify({type: 'hello', v: 1, role, instanceId})
}

describe('emulator viewer admission', () => {
  it('admits a viewer from the engine origin and hands it the reload frame', async () => {
    const broker = await startEmulatorSession()
    const ws = dial(ENGINE)
    await opened(ws)
    ws.send(hello('viewer'))

    expect(await nextFrame(ws)).toEqual({
      type: 'ready',
      runId: 'run-A',
      engine: 'emulator'
    })

    expect(broker.viewerCount).toBe(1)

    const reload = nextFrame(ws)
    const notified = broker.broadcastReload({
      type: 'content-scripts',
      label: 'content_script (content/scripts.ts)',
      changedContentScriptEntries: ['content_scripts/content-0'],
      changedFiles: ['content/scripts.ts']
    })
    expect(notified).toBe(1)
    expect(await reload).toEqual({
      type: 'reload',
      reloadType: 'content-scripts',
      label: 'content_script (content/scripts.ts)',
      changedContentScriptEntries: ['content_scripts/content-0'],
      changedFiles: ['content/scripts.ts']
    })
  })

  it.each([
    'full',
    'service-worker',
    'content-scripts',
    'page'
  ] as const)('relays the %s reload word unchanged', async (reloadType) => {
    const broker = await startEmulatorSession()
    const ws = dial(ENGINE)
    await opened(ws)
    ws.send(hello('viewer'))
    await nextFrame(ws)

    const frame = nextFrame(ws)
    broker.broadcastReload({type: reloadType, label: 'x'})
    expect((await frame).reloadType).toBe(reloadType)
  })

  it('latches a reload sent while no viewer is open and releases it on ack', async () => {
    const broker = await startEmulatorSession()
    expect(broker.broadcastReload({type: 'full', label: 'extension'})).toBe(0)

    const ws = dial(ENGINE)
    await opened(ws)
    const frames: any[] = []
    ws.on('message', (d) => frames.push(JSON.parse(d.toString())))
    ws.send(hello('viewer'))
    await new Promise((r) => setTimeout(r, 150))
    expect(frames.map((f) => f.type)).toEqual(['ready', 'reload'])

    broker.broadcastReload({type: 'content-scripts', label: 'cs'})
    await new Promise((r) => setTimeout(r, 100))
    ws.send(JSON.stringify({type: 'reload-ack', reloadType: 'content-scripts'}))
    await new Promise((r) => setTimeout(r, 100))

    const again = dial(ENGINE)
    await opened(again)
    const replay: any[] = []
    again.on('message', (d) => replay.push(JSON.parse(d.toString())))
    again.send(hello('viewer'))
    await new Promise((r) => setTimeout(r, 150))
    expect(replay.map((f) => f.type)).toEqual(['ready'])
  })

  it.each([
    'https://attacker.example',
    'https://browsers.extension.land.attacker.example',
    'http://browsers.extension.land',
    'https://browsers.extension.land:8443',
    'null'
  ])('refuses the upgrade from the foreign origin %s', async (origin) => {
    await startEmulatorSession()
    expect(await upgradeStatus(dial(origin))).toBe(401)
  })

  it('refuses a viewer that names the wrong instanceId', async () => {
    const broker = await startEmulatorSession()
    const ws = dial(ENGINE)
    await opened(ws)
    const code = closed(ws)
    ws.send(hello('viewer', 'inst-stale'))
    expect(await code).toBe(CLOSE_BAD_INSTANCE)
    expect(broker.viewerCount).toBe(0)
  })

  it.each([
    'producer',
    'consumer',
    'controller'
  ])('refuses the %s role from the engine origin', async (role) => {
    const broker = await startEmulatorSession()
    const ws = dial(ENGINE)
    await opened(ws)
    const code = closed(ws)
    ws.send(hello(role))
    expect(await code).toBe(CLOSE_BAD_HELLO)
    expect(broker.producerCount + broker.consumerCount).toBe(0)
  })

  it('refuses the viewer role from a client that sends no Origin', async () => {
    await startEmulatorSession()
    const ws = dial()
    await opened(ws)
    const code = closed(ws)
    ws.send(hello('viewer'))
    expect(await code).toBe(CLOSE_BAD_HELLO)
  })

  it('keeps refusing every web origin when no engine origin is configured', async () => {
    await startEmulatorSession(null)
    expect(await upgradeStatus(dial(ENGINE))).toBe(401)
    expect(isAdmittedOrigin(ENGINE, undefined)).toBe(false)
    expect(isAdmittedOrigin('chrome-extension://id', undefined)).toBe(true)
    expect(isAdmittedOrigin(undefined, undefined)).toBe(true)
  })

  it('names the page, not a service worker, when a reload reaches nobody', () => {
    let now = 0
    const broker = new BridgeBroker({
      instanceId: 'inst-1',
      runId: 'run-A',
      engine: 'emulator',
      viewerOrigin: ENGINE,
      now: () => now
    })
    now = 60_000
    broker.broadcastReload({type: 'full'})
    expect(broker.undeliveredReloadWarning()).toMatch(
      /^No emulated Chromium page is connected/
    )
  })
})
