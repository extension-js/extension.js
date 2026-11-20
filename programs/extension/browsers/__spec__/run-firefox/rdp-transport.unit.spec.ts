import net from 'node:net'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {buildRdpFrame} from '../../run-firefox/rdp/remote-firefox/rdp-wire'
import {RdpTransport} from '../../run-firefox/rdp/remote-firefox/transport'

function createMockServer(): Promise<{
  server: net.Server
  port: number
  connections: net.Socket[]
}> {
  return new Promise((resolve) => {
    const connections: net.Socket[] = []
    const server = net.createServer((socket) => {
      connections.push(socket)
      socket.write(
        buildRdpFrame({from: 'root', applicationType: 'browser', traits: {}})
      )
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo
      resolve({server, port: addr.port, connections})
    })
  })
}

function waitForConnection(
  state: {connections: net.Socket[]},
  timeout = 2000
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error('no connection within timeout')),
      timeout
    )

    const check = () => {
      if (state.connections.length > 0) {
        clearTimeout(t)
        resolve(state.connections[state.connections.length - 1])
      } else {
        setTimeout(check, 10)
      }
    }

    check()
  })
}

function sendResponse(sock: net.Socket, payload: Record<string, unknown>) {
  sock.write(buildRdpFrame(payload))
}

// What every request in flight is rejected with when the wire goes away.
const CHANNEL_CLOSED = {
  code: 'E_BROWSER_CONNECTION_CLOSED',
  message: expect.stringContaining(
    'The Firefox messaging channel closed unexpectedly.'
  )
}

describe('RdpTransport', () => {
  let mockState: Awaited<ReturnType<typeof createMockServer>>
  let transport: RdpTransport

  beforeEach(async () => {
    mockState = await createMockServer()
    transport = new RdpTransport()
  })

  afterEach(async () => {
    try {
      transport.disconnect()
    } catch {
      // Ignore
    }

    await new Promise<void>((resolve) => {
      mockState.server.close(() => resolve())
      for (const c of mockState.connections) c.destroy()
    })
  })

  it('rejects the in-flight request and every queued one on disconnect', async () => {
    await transport.connect(mockState.port)

    const req1 = transport.request({to: 'tab-1', type: 'attach'})
    const req2 = transport.request({to: 'tab-1', type: 'navigateTo'})
    const req3 = transport.request({to: 'tab-1', type: 'close'})

    await new Promise((r) => setTimeout(r, 30))
    transport.disconnect()

    await expect(req1).rejects.toMatchObject(CHANNEL_CLOSED)
    await expect(req2).rejects.toMatchObject(CHANNEL_CLOSED)
    await expect(req3).rejects.toMatchObject(CHANNEL_CLOSED)
  })

  it('allows concurrent requests to different actors', async () => {
    await transport.connect(mockState.port)
    const sock = await waitForConnection(mockState)

    const reqA = transport.request({to: 'tab-A', type: 'attach'})
    const reqB = transport.request({to: 'tab-B', type: 'attach'})

    await new Promise((r) => setTimeout(r, 30))

    sendResponse(sock, {from: 'tab-B', type: 'attached'})
    sendResponse(sock, {from: 'tab-A', type: 'attached'})

    const [resultA, resultB] = await Promise.all([reqA, reqB])
    expect(resultA).toMatchObject({from: 'tab-A'})
    expect(resultB).toMatchObject({from: 'tab-B'})
  })

  it('rejects the correct actor on RDP error without affecting others', async () => {
    await transport.connect(mockState.port)
    const sock = await waitForConnection(mockState)

    const reqA = transport.request({to: 'tab-A', type: 'attach'})
    const reqB = transport.request({to: 'tab-B', type: 'attach'})

    await new Promise((r) => setTimeout(r, 30))

    sendResponse(sock, {from: 'tab-A', error: true, message: 'noSuchActor'})
    sendResponse(sock, {from: 'tab-B', type: 'attached'})

    await expect(reqA).rejects.toMatchObject({from: 'tab-A', error: true})
    await expect(reqB).resolves.toMatchObject({from: 'tab-B'})
  })

  it('emits unmatched messages as message events', async () => {
    await transport.connect(mockState.port)
    const sock = await waitForConnection(mockState)

    const messages: unknown[] = []
    transport.on('message', (msg) => messages.push(msg))

    sendResponse(sock, {from: 'server', type: 'tabListChanged'})

    await new Promise((r) => setTimeout(r, 50))
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({from: 'server', type: 'tabListChanged'})
  })

  it('handles Firefox greeting frame without errors', async () => {
    const errors: unknown[] = []
    transport.on('error', (e) => errors.push(e))

    await transport.connect(mockState.port)
    const sock = await waitForConnection(mockState)

    sendResponse(sock, {
      from: 'root',
      applicationType: 'browser',
      traits: {}
    })

    await new Promise((r) => setTimeout(r, 50))
    expect(errors).toEqual([])
  })

  it('emits error for messages missing the from field', async () => {
    await transport.connect(mockState.port)
    const sock = await waitForConnection(mockState)

    const errors: unknown[] = []
    transport.on('error', (e) => errors.push(e))

    sendResponse(sock, {type: 'someEvent'})

    await new Promise((r) => setTimeout(r, 50))
    expect(errors).toHaveLength(1)
    expect(String(errors[0])).toContain('without')
  })

  it('holds each request to one actor until the one before it is answered', async () => {
    await transport.connect(mockState.port)
    const sock = await waitForConnection(mockState)

    const r1 = transport.request({to: 'tab-1', type: 'op1'})
    const r2 = transport.request({to: 'tab-1', type: 'op2'})
    const r3 = transport.request({to: 'tab-1', type: 'op3'})

    await new Promise((r) => setTimeout(r, 30))
    sendResponse(sock, {from: 'tab-1', result: 'res1'})
    const res1 = await r1
    expect(res1).toMatchObject({result: 'res1'})

    await new Promise((r) => setTimeout(r, 30))
    sendResponse(sock, {from: 'tab-1', result: 'res2'})
    const res2 = await r2
    expect(res2).toMatchObject({result: 'res2'})

    await new Promise((r) => setTimeout(r, 30))
    sendResponse(sock, {from: 'tab-1', result: 'res3'})
    const res3 = await r3
    expect(res3).toMatchObject({result: 'res3'})
  })

  it('actor error does not block requests to other actors', async () => {
    await transport.connect(mockState.port)
    const sock = await waitForConnection(mockState)

    const reqA = transport.request({to: 'tab-A', type: 'attach'})
    const reqB1 = transport.request({to: 'tab-B', type: 'op1'})
    const reqB2 = transport.request({to: 'tab-B', type: 'op2'})

    await new Promise((r) => setTimeout(r, 30))

    sendResponse(sock, {from: 'tab-A', error: true, message: 'failed'})
    await expect(reqA).rejects.toMatchObject({error: true})

    sendResponse(sock, {from: 'tab-B', result: 'b1'})
    await expect(reqB1).resolves.toMatchObject({result: 'b1'})

    await new Promise((r) => setTimeout(r, 30))
    sendResponse(sock, {from: 'tab-B', result: 'b2'})
    await expect(reqB2).resolves.toMatchObject({result: 'b2'})
  })

  it('rejects in-flight requests and emits end when the server closes', async () => {
    await transport.connect(mockState.port)
    const sock = await waitForConnection(mockState)

    const endPromise = new Promise<void>((resolve) => {
      transport.on('end', () => resolve())
    })

    const req = transport.request({to: 'tab-1', type: 'attach'})
    await new Promise((r) => setTimeout(r, 30))

    sock.end()

    await endPromise
    await expect(req).rejects.toMatchObject(CHANNEL_CLOSED)
  })

  it('rejects a request that never gets a reply after the timeout', async () => {
    process.env.EXTENSION_RDP_REQUEST_TIMEOUT_MS = '60'
    const t = new RdpTransport()

    try {
      await t.connect(mockState.port)
      await expect(t.request({to: 'tab-1', type: 'noReply'})).rejects.toThrow(
        /timed out/
      )
    } finally {
      delete process.env.EXTENSION_RDP_REQUEST_TIMEOUT_MS

      try {
        t.disconnect()
      } catch {
        // Ignore
      }
    }
  })

  it('codes a request that timed out as E_RDP_PROTOCOL', async () => {
    vi.stubEnv('EXTENSION_RDP_REQUEST_TIMEOUT_MS', '60')

    try {
      await transport.connect(mockState.port)

      const error = await transport
        .request({to: 'tab-1', type: 'noReply'})
        .then(
          () => null,
          (reason: unknown) => reason
        )

      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe(
        'RDP request to "tab-1" timed out after 60ms'
      )

      expect(Object.entries(error as Error)).toEqual([
        ['code', 'E_RDP_PROTOCOL']
      ])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('codes a frame with no sender as E_RDP_PROTOCOL and keeps the connection', async () => {
    await transport.connect(mockState.port)
    const sock = await waitForConnection(mockState)
    const errors: Array<Error & {code?: string}> = []
    transport.on('error', (e) => errors.push(e))

    sendResponse(sock, {type: 'someEvent'})
    const answered = transport.request({to: 'root', type: 'getRoot'})
    await new Promise((r) => setTimeout(r, 30))
    sendResponse(sock, {from: 'root', addonsActor: 'addons1'})

    await expect(answered).resolves.toEqual({
      from: 'root',
      addonsActor: 'addons1'
    })

    expect(errors.map((e) => e.code)).toEqual(['E_RDP_PROTOCOL'])
  })

  it('codes a body that is not JSON as E_RDP_PROTOCOL and reads the next frame', async () => {
    await transport.connect(mockState.port)
    const sock = await waitForConnection(mockState)
    const errors: Array<Error & {code?: string}> = []
    const messages: unknown[] = []
    transport.on('error', (e) => errors.push(e))
    transport.on('message', (m) => messages.push(m))

    sock.write(`9:{not json${buildRdpFrame({from: 'root', type: 'later'})}`)

    await vi.waitFor(() =>
      expect(messages).toEqual([{from: 'root', type: 'later'}])
    )

    expect(errors.map((e) => e.code)).toEqual(['E_RDP_PROTOCOL'])
    expect(errors[0].message).toContain("Can't parse a message from Firefox.")
  })

  it('codes a length prefix that is not a number as E_RDP_PROTOCOL and ends the connection', async () => {
    await transport.connect(mockState.port)
    const sock = await waitForConnection(mockState)
    const errors: Array<Error & {code?: string}> = []
    transport.on('error', (e) => errors.push(e))
    const ended = new Promise<void>((resolve) => transport.on('end', resolve))
    const inFlight = transport.request({to: 'tab-1', type: 'attach'})
    const settled = inFlight.then(
      () => null,
      (reason: unknown) => reason
    )

    sock.write('abc:{"from":"root"}')
    await ended

    expect(errors.map((e) => e.code)).toEqual(['E_RDP_PROTOCOL'])
    expect(errors[0].message).toContain('Invalid RDP frame length')
    expect(await settled).toMatchObject(CHANNEL_CLOSED)
  })

  it('rejects a request made before connect instead of throwing', async () => {
    const t = new RdpTransport()
    await expect(
      t.request({to: 'root', type: 'listTabs'})
    ).rejects.toMatchObject({
      code: 'E_BROWSER_CONNECTION_CLOSED',
      message: expect.stringContaining(
        'The debugging connection to Firefox closed unexpectedly.'
      )
    })
  })
})
