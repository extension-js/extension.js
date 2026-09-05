import net from 'node:net'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {MessagingClient} from '../../run-firefox/rdp/remote-firefox/messaging-client'
import {buildRdpFrame} from '../../run-firefox/rdp/remote-firefox/rdp-wire'
import {RdpTransport} from '../../run-firefox/rdp/remote-firefox/transport'

type Server = {
  server: net.Server
  port: number
  connections: net.Socket[]
}

function createMockServer(): Promise<Server> {
  return new Promise((resolve) => {
    const connections: net.Socket[] = []
    const server = net.createServer((socket) => {
      connections.push(socket)
      socket.on('error', () => {
        // Ignore
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo
      resolve({server, port: addr.port, connections})
    })
  })
}

async function lastSocket(state: Server, index = 0): Promise<net.Socket> {
  for (let i = 0; i < 200; i++) {
    if (state.connections.length > index) return state.connections[index]
    await sleep(10)
  }
  throw new Error('no connection within timeout')
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const settled = (p: Promise<unknown>) =>
  p.then(
    () => 'resolved',
    (e: Error) => e.message
  )

describe('RdpTransport death handling', () => {
  let mock: Server
  let transport: RdpTransport

  beforeEach(async () => {
    mock = await createMockServer()
    transport = new RdpTransport()
    process.env.EXTENSION_RDP_REQUEST_TIMEOUT_MS = '1500'
  })

  afterEach(async () => {
    delete process.env.EXTENSION_RDP_REQUEST_TIMEOUT_MS
    transport.disconnect()
    await new Promise<void>((resolve) => {
      mock.server.close(() => resolve())
      for (const c of mock.connections) c.destroy()
    })
  })

  it('logs a sender-less frame when nobody listens and keeps serving', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await transport.connect(mock.port)
      const sock = await lastSocket(mock)

      sock.write(buildRdpFrame({type: 'someEvent'}))
      await sleep(50)

      expect(spy).toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0][0])).toContain('without a sender')

      const later = transport.request({to: 'root', type: 'listTabs'})
      await sleep(30)
      sock.write(buildRdpFrame({from: 'root', tabs: []}))
      await expect(later).resolves.toMatchObject({from: 'root'})
    } finally {
      spy.mockRestore()
    }
  })

  it('tears the connection down on a malformed length prefix', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await transport.connect(mock.port)
      const sock = await lastSocket(mock)
      const inFlight = settled(transport.request({to: 'tab-1', type: 'attach'}))
      const queued = settled(transport.request({to: 'tab-1', type: 'close'}))
      await sleep(30)

      sock.write('abc:{"from":"root"}')

      const started = Date.now()
      const [a, b] = await Promise.all([inFlight, queued])
      expect(Date.now() - started).toBeLessThan(500)
      expect(a).toMatch(/closed unexpectedly/)
      expect(b).toMatch(/closed unexpectedly/)
      expect(a).not.toMatch(/timed out/)
    } finally {
      spy.mockRestore()
    }
  })

  it('rejects in-flight requests promptly with the closed reason on a reset', async () => {
    await transport.connect(mock.port)
    const sock = await lastSocket(mock)
    const ended = new Promise<void>((resolve) => transport.on('end', resolve))
    const req = settled(transport.request({to: 'tab-1', type: 'attach'}))
    await sleep(30)

    const started = Date.now()
    sock.resetAndDestroy()

    const reason = await req
    await ended
    expect(Date.now() - started).toBeLessThan(500)
    expect(reason).toMatch(/closed unexpectedly/)
    expect(reason).not.toMatch(/timed out/)
  })

  it('fails a request made after the socket died without a timer', async () => {
    await transport.connect(mock.port)
    const sock = await lastSocket(mock)
    sock.resetAndDestroy()
    await sleep(50)

    const started = Date.now()
    const reason = await settled(
      transport.request({to: 'tab-2', type: 'attach'})
    )
    expect(Date.now() - started).toBeLessThan(100)
    expect(reason).toMatch(/closed unexpectedly/)
  })

  it('emits end exactly once when FIN and close both fire', async () => {
    await transport.connect(mock.port)
    const sock = await lastSocket(mock)
    let ends = 0
    transport.on('end', () => ends++)

    sock.end()
    await sleep(100)
    sock.destroy()
    await sleep(50)

    expect(ends).toBe(1)
  })
})

describe('MessagingClient reconnect', () => {
  let mock: Server

  beforeEach(async () => {
    mock = await createMockServer()
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      mock.server.close(() => resolve())
      for (const c of mock.connections) c.destroy()
    })
  })

  it('reconnects after the peer resets the socket', async () => {
    const client = new MessagingClient()
    await client.connect(mock.port)
    const reconnected = new Promise<void>((resolve) =>
      client.on('reconnected', resolve)
    )
    const sock = await lastSocket(mock)

    sock.resetAndDestroy()

    await reconnected
    await lastSocket(mock, 1)
    expect(mock.connections).toHaveLength(2)
    client.disconnect()
  }, 10000)

  it('does not reconnect after a user-initiated disconnect', async () => {
    const client = new MessagingClient()
    await client.connect(mock.port)
    await lastSocket(mock)

    client.disconnect()
    await sleep(1300)

    expect(mock.connections).toHaveLength(1)
  })
})
