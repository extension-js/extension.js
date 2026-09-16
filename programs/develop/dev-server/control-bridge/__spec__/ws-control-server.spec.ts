import {afterEach, describe, expect, it} from 'vitest'
import {WebSocket} from 'ws'
import {BridgeBroker} from '../broker'
import {CONTROL_WS_PATH} from '../contracts'
import {
  type ControlServer,
  isWebOrigin,
  startControlServer
} from '../ws-control-server'

let server: ControlServer | null = null
const sockets: WebSocket[] = []

afterEach(async () => {
  for (const s of sockets) {
    try {
      s.terminate()
    } catch {
      // Ignore
    }
  }

  sockets.length = 0

  if (server) {
    await server.close()
    server = null
  }
})

function connect(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${CONTROL_WS_PATH}`)
  sockets.push(ws)

  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

function nextFrame(ws: WebSocket, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error('timeout waiting for frame')),
      timeoutMs
    )
    ws.once('message', (data) => {
      clearTimeout(t)
      resolve(JSON.parse(data.toString()))
    })
  })
}

describe('ws control server (integration)', () => {
  it('delivers a producer log to a consumer over real sockets', async () => {
    const broker = new BridgeBroker({
      instanceId: 'inst-1',
      runId: 'run-A',
      engine: 'chromium'
    })
    server = await startControlServer({broker})
    expect(server.port).toBeGreaterThan(0)

    const consumer = await connect(server.port)
    consumer.send(
      JSON.stringify({
        type: 'hello',
        v: 1,
        role: 'consumer',
        instanceId: 'inst-1'
      })
    )

    const ready = await nextFrame(consumer)
    expect(ready).toMatchObject({
      type: 'ready',
      runId: 'run-A',
      engine: 'chromium'
    })

    const producer = await connect(server.port)
    producer.send(
      JSON.stringify({
        type: 'hello',
        v: 1,
        role: 'producer',
        instanceId: 'inst-1'
      })
    )

    producer.send(
      JSON.stringify({
        type: 'log',
        event: {
          v: 1,
          id: 'x',
          timestamp: 0,
          level: 'error',
          context: 'content',
          messageParts: ['boom'],
          runId: 'run-A'
        }
      })
    )

    const logFrame = await nextFrame(consumer)
    expect(logFrame).toMatchObject({type: 'log'})
    expect(logFrame.event).toMatchObject({
      seq: 1,
      level: 'error',
      context: 'content'
    })
  })

  it.each([
    'http://localhost:3000',
    'https://attacker.example',
    'HTTPS://attacker.example',
    'null'
  ])('refuses the upgrade from a web page Origin %s', async (origin) => {
    const broker = new BridgeBroker({instanceId: 'inst-1', runId: 'run-A'})
    server = await startControlServer({broker})
    const ws = new WebSocket(
      `ws://127.0.0.1:${server.port}${CONTROL_WS_PATH}`,
      {
        origin
      }
    )
    sockets.push(ws)
    const status = await new Promise<number>((resolve, reject) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
      ws.on('open', () => reject(new Error('web Origin was accepted')))
      ws.on('error', () => undefined)
    })
    expect(status).toBe(401)
  })

  it.each([
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
    'moz-extension://2d3f5e1a-0000-4000-8000-000000000000',
    'safari-web-extension://2D3F5E1A-0000-4000-8000-000000000000'
  ])('accepts the extension producer Origin %s', async (origin) => {
    const broker = new BridgeBroker({
      instanceId: 'inst-1',
      runId: 'run-A',
      engine: 'chromium'
    })
    server = await startControlServer({broker})
    const ws = new WebSocket(
      `ws://127.0.0.1:${server.port}${CONTROL_WS_PATH}`,
      {
        origin
      }
    )
    sockets.push(ws)
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', reject)
    })

    ws.send(
      JSON.stringify({
        type: 'hello',
        v: 1,
        role: 'consumer',
        instanceId: 'inst-1'
      })
    )

    expect(await nextFrame(ws)).toMatchObject({type: 'ready'})
  })

  it('treats http, https and the opaque null as a web Origin', () => {
    expect(isWebOrigin(undefined)).toBe(false)
    expect(isWebOrigin('')).toBe(false)
    expect(isWebOrigin('chrome-extension://id')).toBe(false)
    expect(isWebOrigin('moz-extension://id')).toBe(false)
    expect(isWebOrigin('safari-web-extension://id')).toBe(false)
    expect(isWebOrigin('http://127.0.0.1:8080')).toBe(true)
    expect(isWebOrigin('https://example.com')).toBe(true)
    expect(isWebOrigin('null')).toBe(true)
    expect(isWebOrigin('NULL')).toBe(true)
  })

  it('accepts a Node client that sends no Origin', async () => {
    const broker = new BridgeBroker({instanceId: 'inst-1', runId: 'run-A'})
    server = await startControlServer({broker})
    const ws = await connect(server.port)
    ws.send(
      JSON.stringify({
        type: 'hello',
        v: 1,
        role: 'consumer',
        instanceId: 'inst-1'
      })
    )

    expect(await nextFrame(ws)).toMatchObject({type: 'ready'})
  })

  it('closes a socket that presents the wrong instanceId', async () => {
    const broker = new BridgeBroker({instanceId: 'right', runId: 'run-A'})
    server = await startControlServer({broker})
    const ws = await connect(server.port)
    const closed = new Promise<number>((resolve) =>
      ws.on('close', (code) => resolve(code))
    )
    ws.send(
      JSON.stringify({
        type: 'hello',
        v: 1,
        role: 'consumer',
        instanceId: 'wrong'
      })
    )

    expect(await closed).toBe(4001)
  })
})
