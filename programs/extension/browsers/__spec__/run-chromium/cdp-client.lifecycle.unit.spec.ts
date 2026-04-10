import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {EventEmitter} from 'events'

// Mock discovery + ws before importing CDPClient
const lifecycleMocks = vi.hoisted(() => ({
  discoverUrl: vi.fn(),
  establishConnection: vi.fn()
}))

vi.mock('../../run-chromium/chromium-source-inspection/discovery', () => ({
  discoverWebSocketDebuggerUrl: lifecycleMocks.discoverUrl,
  checkChromeRemoteDebugging: vi.fn(async () => true)
}))

vi.mock('../../run-chromium/chromium-source-inspection/ws', () => ({
  establishBrowserConnection: lifecycleMocks.establishConnection
}))

import {CDPClient} from '../../run-chromium/chromium-source-inspection/cdp-client'

function createMockWs() {
  const ws: any = new EventEmitter()
  ws.readyState = 1 // OPEN
  ws.close = vi.fn(() => {
    ws.readyState = 3
  })
  ws.send = vi.fn()
  return ws
}

describe('CDPClient lifecycle', () => {
  beforeEach(() => {
    lifecycleMocks.discoverUrl.mockReset()
    lifecycleMocks.establishConnection.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -----------------------------------------------------------------------
  // connect() error propagation
  // -----------------------------------------------------------------------

  it('propagates discovery errors through connect()', async () => {
    lifecycleMocks.discoverUrl.mockRejectedValue(
      new Error('No CDP WebSocket URL available')
    )

    const client = new CDPClient(9222)
    await expect(client.connect()).rejects.toThrow(
      'No CDP WebSocket URL available'
    )
  })

  it('propagates WebSocket connection errors through connect()', async () => {
    lifecycleMocks.discoverUrl.mockResolvedValue(
      'ws://127.0.0.1:9222/devtools/browser'
    )
    lifecycleMocks.establishConnection.mockRejectedValue(
      new Error('ECONNREFUSED')
    )

    const client = new CDPClient(9222)
    await expect(client.connect()).rejects.toThrow('ECONNREFUSED')
  })

  // -----------------------------------------------------------------------
  // disconnect()
  // -----------------------------------------------------------------------

  it('closes the WebSocket on disconnect', async () => {
    const mockWs = createMockWs()
    lifecycleMocks.discoverUrl.mockResolvedValue('ws://localhost:9222')
    lifecycleMocks.establishConnection.mockResolvedValue(mockWs)

    const client = new CDPClient(9222)
    await client.connect()

    expect(client.isConnected()).toBe(true)

    client.disconnect()

    expect(mockWs.close).toHaveBeenCalledTimes(1)
    expect(client.isConnected()).toBe(false)
  })

  it('disconnect is safe to call multiple times', async () => {
    const mockWs = createMockWs()
    lifecycleMocks.discoverUrl.mockResolvedValue('ws://localhost:9222')
    lifecycleMocks.establishConnection.mockResolvedValue(mockWs)

    const client = new CDPClient(9222)
    await client.connect()

    client.disconnect()
    client.disconnect()
    client.disconnect()

    // close() only called on first disconnect since ws is nulled after
    expect(mockWs.close).toHaveBeenCalledTimes(1)
  })

  it('disconnect before connect does not throw', () => {
    const client = new CDPClient(9222)
    expect(() => client.disconnect()).not.toThrow()
  })

  // -----------------------------------------------------------------------
  // isConnected()
  // -----------------------------------------------------------------------

  it('returns false before connect', () => {
    const client = new CDPClient(9222)
    expect(client.isConnected()).toBe(false)
  })

  it('returns false after disconnect', async () => {
    const mockWs = createMockWs()
    lifecycleMocks.discoverUrl.mockResolvedValue('ws://localhost:9222')
    lifecycleMocks.establishConnection.mockResolvedValue(mockWs)

    const client = new CDPClient(9222)
    await client.connect()
    client.disconnect()

    expect(client.isConnected()).toBe(false)
  })

  // -----------------------------------------------------------------------
  // onProtocolEvent — registration and unsubscription
  // -----------------------------------------------------------------------

  it('registers and fires protocol event handlers', async () => {
    const mockWs = createMockWs()
    lifecycleMocks.discoverUrl.mockResolvedValue('ws://localhost:9222')
    lifecycleMocks.establishConnection.mockResolvedValue(mockWs)

    const client = new CDPClient(9222)
    await client.connect()

    const events: unknown[] = []
    client.onProtocolEvent((msg) => events.push(msg))

    // Simulate an event (no id → treated as event, dispatched to callbacks)
    ;(client as any).handleMessage(
      JSON.stringify({method: 'Target.targetCreated', params: {targetId: 't1'}})
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({method: 'Target.targetCreated'})
  })

  it('unsubscribes protocol event handlers via returned function', async () => {
    const mockWs = createMockWs()
    lifecycleMocks.discoverUrl.mockResolvedValue('ws://localhost:9222')
    lifecycleMocks.establishConnection.mockResolvedValue(mockWs)

    const client = new CDPClient(9222)
    await client.connect()

    const events: unknown[] = []
    const unsubscribe = client.onProtocolEvent((msg) => events.push(msg))

    ;(client as any).handleMessage(JSON.stringify({method: 'event-1'}))

    unsubscribe()

    ;(client as any).handleMessage(JSON.stringify({method: 'event-2'}))

    // Only the first event should have been received
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({method: 'event-1'})
  })

  // -----------------------------------------------------------------------
  // handleMessage — responses vs events
  // -----------------------------------------------------------------------

  it('routes messages with id to pending requests, not event callbacks', async () => {
    const mockWs = createMockWs()
    lifecycleMocks.discoverUrl.mockResolvedValue('ws://localhost:9222')
    lifecycleMocks.establishConnection.mockResolvedValue(mockWs)

    const client = new CDPClient(9222)
    await client.connect()

    const events: unknown[] = []
    client.onProtocolEvent((msg) => events.push(msg))

    // Send a command
    const promise = client.sendCommand('Target.getTargets')
    const sent = JSON.parse(mockWs.send.mock.calls[0][0])

    // Respond to it
    ;(client as any).handleMessage(
      JSON.stringify({id: sent.id, result: {targetInfos: []}})
    )

    await promise

    // The response should NOT appear in event callbacks
    expect(events).toHaveLength(0)
  })

  it('handles malformed JSON gracefully without crashing', async () => {
    const mockWs = createMockWs()
    lifecycleMocks.discoverUrl.mockResolvedValue('ws://localhost:9222')
    lifecycleMocks.establishConnection.mockResolvedValue(mockWs)

    const client = new CDPClient(9222)
    await client.connect()

    // Should not throw
    expect(() => {
      ;(client as any).handleMessage('{not valid json')
    }).not.toThrow()
  })

  // -----------------------------------------------------------------------
  // getTargets / attachToTarget / convenience methods
  // -----------------------------------------------------------------------

  it('getTargets returns empty array when response has no targetInfos', async () => {
    const mockWs = createMockWs()
    lifecycleMocks.discoverUrl.mockResolvedValue('ws://localhost:9222')
    lifecycleMocks.establishConnection.mockResolvedValue(mockWs)

    const client = new CDPClient(9222)
    await client.connect()

    const promise = client.getTargets()
    const sent = JSON.parse(mockWs.send.mock.calls[0][0])

    ;(client as any).handleMessage(JSON.stringify({id: sent.id, result: {}}))

    const targets = await promise
    expect(targets).toEqual([])
  })

  it('attachToTarget returns empty string when no sessionId in response', async () => {
    const mockWs = createMockWs()
    lifecycleMocks.discoverUrl.mockResolvedValue('ws://localhost:9222')
    lifecycleMocks.establishConnection.mockResolvedValue(mockWs)

    const client = new CDPClient(9222)
    await client.connect()

    const promise = client.attachToTarget('target-1')
    const sent = JSON.parse(mockWs.send.mock.calls[0][0])

    ;(client as any).handleMessage(JSON.stringify({id: sent.id, result: {}}))

    const sessionId = await promise
    expect(sessionId).toBe('')
  })
})
