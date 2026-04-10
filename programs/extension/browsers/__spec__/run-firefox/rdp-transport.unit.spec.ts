import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import net from 'net'

// We test RdpTransport directly — it is the core RDP connection layer.
// These tests cover per-actor request queuing, error isolation,
// disconnect cleanup, and event forwarding.
import {RdpTransport} from '../../run-firefox/firefox-source-inspection/remote-firefox/transport'
import {buildRdpFrame} from '../../run-firefox/firefox-source-inspection/remote-firefox/rdp-wire'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockServer(): Promise<{
  server: net.Server
  port: number
  connections: net.Socket[]
}> {
  return new Promise((resolve) => {
    const connections: net.Socket[] = []
    const server = net.createServer((socket) => {
      connections.push(socket)
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
    } catch {}
    await new Promise<void>((resolve) => {
      mockState.server.close(() => resolve())
      for (const c of mockState.connections) c.destroy()
    })
  })

  // -----------------------------------------------------------------------
  // 1. disconnect() rejects all pending and queued requests
  // -----------------------------------------------------------------------

  it('rejects pending requests when disconnect() is called', async () => {
    await transport.connect(mockState.port)

    const pending = transport.request({to: 'root', type: 'listTabs'})

    // Give the write a tick to flush to the active map
    await new Promise((r) => setTimeout(r, 30))

    transport.disconnect()

    await expect(pending).rejects.toThrow()
  })

  it('rejects all queued requests for an actor on disconnect', async () => {
    await transport.connect(mockState.port)

    const req1 = transport.request({to: 'tab-1', type: 'attach'})
    const req2 = transport.request({to: 'tab-1', type: 'navigateTo'})
    const req3 = transport.request({to: 'tab-1', type: 'close'})

    await new Promise((r) => setTimeout(r, 30))
    transport.disconnect()

    await expect(req1).rejects.toThrow()
    await expect(req2).rejects.toThrow()
    await expect(req3).rejects.toThrow()
  })

  // -----------------------------------------------------------------------
  // 2. Per-actor queuing — only one in-flight request per actor
  // -----------------------------------------------------------------------

  it('queues a second request to the same actor until the first resolves', async () => {
    await transport.connect(mockState.port)
    const sock = await waitForConnection(mockState)

    const first = transport.request({to: 'tab-1', type: 'attach'})
    const second = transport.request({
      to: 'tab-1',
      type: 'navigateTo',
      url: 'https://example.com'
    })

    // Only the first request is on the wire. Respond to it.
    await new Promise((r) => setTimeout(r, 30))
    sendResponse(sock, {from: 'tab-1', type: 'attached'})

    const firstResult = await first

    // Now the second request flushes. Respond to it.
    await new Promise((r) => setTimeout(r, 30))
    sendResponse(sock, {from: 'tab-1', type: 'navigated'})

    const secondResult = await second

    expect(firstResult).toMatchObject({from: 'tab-1', type: 'attached'})
    expect(secondResult).toMatchObject({from: 'tab-1', type: 'navigated'})
  })

  it('allows concurrent requests to different actors', async () => {
    await transport.connect(mockState.port)
    const sock = await waitForConnection(mockState)

    const reqA = transport.request({to: 'tab-A', type: 'attach'})
    const reqB = transport.request({to: 'tab-B', type: 'attach'})

    await new Promise((r) => setTimeout(r, 30))

    // Respond in reverse order — both are in-flight concurrently
    sendResponse(sock, {from: 'tab-B', type: 'attached'})
    sendResponse(sock, {from: 'tab-A', type: 'attached'})

    const [resultA, resultB] = await Promise.all([reqA, reqB])
    expect(resultA).toMatchObject({from: 'tab-A'})
    expect(resultB).toMatchObject({from: 'tab-B'})
  })

  // -----------------------------------------------------------------------
  // 3. Error responses are routed correctly without affecting other actors
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // 4. Unmatched messages are emitted as events
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // 5. Firefox greeting frame is emitted as message (no pending for it)
  // -----------------------------------------------------------------------

  it('handles Firefox greeting frame without errors', async () => {
    const errors: unknown[] = []
    transport.on('error', (e) => errors.push(e))

    await transport.connect(mockState.port)
    const sock = await waitForConnection(mockState)

    // Firefox sends a greeting with `from: "root"` on connect
    sendResponse(sock, {
      from: 'root',
      applicationType: 'browser',
      traits: {}
    })

    await new Promise((r) => setTimeout(r, 50))
    // No "without sender" errors expected
    expect(
      errors.filter((e) => String(e).includes('without sender'))
    ).toHaveLength(0)
  })

  // -----------------------------------------------------------------------
  // 6. Messages without `from` field emit error
  // -----------------------------------------------------------------------

  it('emits error for messages missing the from field', async () => {
    await transport.connect(mockState.port)
    const sock = await waitForConnection(mockState)

    const errors: unknown[] = []
    transport.on('error', (e) => errors.push(e))

    sendResponse(sock, {type: 'someEvent'} as any)

    await new Promise((r) => setTimeout(r, 50))
    expect(errors).toHaveLength(1)
    expect(String(errors[0])).toContain('without')
  })

  // -----------------------------------------------------------------------
  // 7. Multiple responses for same actor flush the queue correctly
  // -----------------------------------------------------------------------

  it('flushes three sequential requests to same actor correctly', async () => {
    await transport.connect(mockState.port)
    const sock = await waitForConnection(mockState)

    const r1 = transport.request({to: 'tab-1', type: 'op1'})
    const r2 = transport.request({to: 'tab-1', type: 'op2'})
    const r3 = transport.request({to: 'tab-1', type: 'op3'})

    // Respond to each in sequence — each response should flush the next
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

  // -----------------------------------------------------------------------
  // 8. Mixed actor queue: one actor error doesn't block others
  // -----------------------------------------------------------------------

  it('actor error does not block requests to other actors', async () => {
    await transport.connect(mockState.port)
    const sock = await waitForConnection(mockState)

    const reqA = transport.request({to: 'tab-A', type: 'attach'})
    const reqB1 = transport.request({to: 'tab-B', type: 'op1'})
    const reqB2 = transport.request({to: 'tab-B', type: 'op2'})

    await new Promise((r) => setTimeout(r, 30))

    // tab-A errors
    sendResponse(sock, {from: 'tab-A', error: true, message: 'failed'})
    await expect(reqA).rejects.toMatchObject({error: true})

    // tab-B continues fine
    sendResponse(sock, {from: 'tab-B', result: 'b1'})
    await expect(reqB1).resolves.toMatchObject({result: 'b1'})

    await new Promise((r) => setTimeout(r, 30))
    sendResponse(sock, {from: 'tab-B', result: 'b2'})
    await expect(reqB2).resolves.toMatchObject({result: 'b2'})
  })

  // -----------------------------------------------------------------------
  // 9. Socket end event is emitted (even though it doesn't reject pending)
  //
  //    NOTE: This documents a gap — when the server closes the connection,
  //    the transport emits 'end' but does NOT reject pending requests.
  //    Callers relying on request() must add their own timeout or listen
  //    for the 'end' event to avoid hanging promises.
  // -----------------------------------------------------------------------

  it('emits end event when server closes connection', async () => {
    await transport.connect(mockState.port)
    const sock = await waitForConnection(mockState)

    const endPromise = new Promise<void>((resolve) => {
      transport.on('end', () => resolve())
    })

    sock.end()

    await endPromise
    // 'end' was emitted — callers can listen for this to handle cleanup
  })
})
