import {describe, it, expect, afterEach} from 'vitest'
import {WebSocket} from 'ws'
import {startControlServer, type ControlServer} from '../ws-control-server'
import {BridgeBroker} from '../broker'
import {CONTROL_WS_PATH} from '../contracts'

let server: ControlServer | null = null
const sockets: WebSocket[] = []

afterEach(async () => {
  for (const s of sockets) {
    try {
      s.terminate()
    } catch {
      // ignore
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

/** Resolve with the next parsed message, or reject after a timeout. */
function nextFrame(ws: WebSocket, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for frame')), timeoutMs)
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
    consumer.send(JSON.stringify({type: 'hello', v: 1, role: 'consumer', instanceId: 'inst-1'}))
    const ready = await nextFrame(consumer)
    expect(ready).toMatchObject({type: 'ready', runId: 'run-A', engine: 'chromium'})

    const producer = await connect(server.port)
    producer.send(JSON.stringify({type: 'hello', v: 1, role: 'producer', instanceId: 'inst-1'}))
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
    expect(logFrame.event).toMatchObject({seq: 1, level: 'error', context: 'content'})
  })

  it('closes a socket that presents the wrong instanceId', async () => {
    const broker = new BridgeBroker({instanceId: 'right', runId: 'run-A'})
    server = await startControlServer({broker})
    const ws = await connect(server.port)
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
    ws.send(JSON.stringify({type: 'hello', v: 1, role: 'consumer', instanceId: 'wrong'}))
    expect(await closed).toBe(4001)
  })
})
