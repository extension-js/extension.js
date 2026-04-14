import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {EventEmitter} from 'events'
import WebSocket from 'ws'

// We test CDPClient.sendCommand directly with a mock WebSocket to exercise
// timeout cleanup, late-response handling, and the timeout-vs-close race.

// Mock the discovery and ws modules to prevent real network calls
vi.mock('../../run-chromium/chromium-source-inspection/discovery', () => ({
  discoverWebSocketDebuggerUrl: vi.fn(
    async () => 'ws://127.0.0.1:9222/devtools/browser'
  ),
  checkChromeRemoteDebugging: vi.fn(async () => true)
}))

vi.mock('../../run-chromium/chromium-source-inspection/ws', () => ({
  establishBrowserConnection: vi.fn()
}))

import {CDPClient} from '../../run-chromium/chromium-source-inspection/cdp-client'
import {establishBrowserConnection} from '../../run-chromium/chromium-source-inspection/ws'

describe('CDPClient.sendCommand', () => {
  let client: CDPClient
  let mockWs: any

  beforeEach(() => {
    vi.useFakeTimers()
    client = new CDPClient(9222, '127.0.0.1')

    // Create a mock WebSocket
    mockWs = new EventEmitter()
    mockWs.readyState = WebSocket.OPEN
    mockWs.close = vi.fn(() => {
      mockWs.readyState = WebSocket.CLOSED
    })
    mockWs.send = vi.fn()

    // Inject the mock WS directly onto the client
    ;(client as any).ws = mockWs
  })

  afterEach(() => {
    vi.useRealTimers()
    try {
      client.disconnect()
    } catch {}
  })

  // -----------------------------------------------------------------------
  // 1. Normal command/response cycle
  // -----------------------------------------------------------------------

  it('resolves when a matching response arrives', async () => {
    const promise = client.sendCommand('Target.getTargets', {})

    // Extract the sent message to get its ID
    expect(mockWs.send).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(mockWs.send.mock.calls[0][0])
    expect(sent.method).toBe('Target.getTargets')

    // Simulate CDP response
    ;(client as any).handleMessage(
      JSON.stringify({id: sent.id, result: {targetInfos: [{type: 'page'}]}})
    )

    const result = await promise
    expect(result).toEqual({targetInfos: [{type: 'page'}]})
  })

  // -----------------------------------------------------------------------
  // 2. Timeout fires and rejects the pending command
  // -----------------------------------------------------------------------

  it('rejects with timeout error when no response arrives within timeoutMs', async () => {
    const promise = client.sendCommand(
      'Runtime.evaluate',
      {expression: '1+1'},
      undefined,
      500
    )

    // Advance past timeout and catch the rejection in the same tick
    const [, result] = await Promise.allSettled([
      vi.advanceTimersByTimeAsync(501),
      promise
    ])

    expect(result.status).toBe('rejected')
    expect((result as PromiseRejectedResult).reason.message).toContain(
      'CDP command timed out (500ms)'
    )
  })

  // -----------------------------------------------------------------------
  // 3. Response arrives before timeout — timeout is cancelled
  // -----------------------------------------------------------------------

  it('cancels the timeout when response arrives in time', async () => {
    const promise = client.sendCommand(
      'Page.navigate',
      {url: 'about:blank'},
      undefined,
      5000
    )

    const sent = JSON.parse(mockWs.send.mock.calls[0][0])

    // Respond quickly
    ;(client as any).handleMessage(
      JSON.stringify({id: sent.id, result: {frameId: 'frame-1'}})
    )

    const result = await promise
    expect(result).toEqual({frameId: 'frame-1'})

    // Advancing time should NOT cause any additional rejections
    await vi.advanceTimersByTimeAsync(10000)
  })

  // -----------------------------------------------------------------------
  // 4. CDP error response rejects with error details
  // -----------------------------------------------------------------------

  it('rejects with error details when CDP returns an error', async () => {
    const promise = client.sendCommand('Extensions.loadUnpacked', {
      extensionPath: '/bad'
    })

    const sent = JSON.parse(mockWs.send.mock.calls[0][0])

    ;(client as any).handleMessage(
      JSON.stringify({
        id: sent.id,
        error: {code: -32000, message: 'Extension not found'}
      })
    )

    await expect(promise).rejects.toThrow('Extension not found')
  })

  // -----------------------------------------------------------------------
  // 5. sendCommand on closed WebSocket rejects immediately
  // -----------------------------------------------------------------------

  it('rejects immediately when WebSocket is not open', async () => {
    mockWs.readyState = WebSocket.CLOSED

    await expect(client.sendCommand('Target.getTargets')).rejects.toThrow(
      'CDP transport is not open'
    )
  })

  // -----------------------------------------------------------------------
  // 6. Multiple concurrent commands get unique IDs and resolve independently
  // -----------------------------------------------------------------------

  it('handles multiple concurrent commands with unique IDs', async () => {
    const p1 = client.sendCommand('Target.getTargets')
    const p2 = client.sendCommand('Browser.getVersion')

    expect(mockWs.send).toHaveBeenCalledTimes(2)
    const sent1 = JSON.parse(mockWs.send.mock.calls[0][0])
    const sent2 = JSON.parse(mockWs.send.mock.calls[1][0])

    expect(sent1.id).not.toBe(sent2.id)
    expect(sent1.method).toBe('Target.getTargets')
    expect(sent2.method).toBe('Browser.getVersion')

    // Respond out of order
    ;(client as any).handleMessage(
      JSON.stringify({id: sent2.id, result: {product: 'Chrome/120'}})
    )
    ;(client as any).handleMessage(
      JSON.stringify({id: sent1.id, result: {targetInfos: []}})
    )

    await expect(p1).resolves.toEqual({targetInfos: []})
    await expect(p2).resolves.toEqual({product: 'Chrome/120'})
  })

  // -----------------------------------------------------------------------
  // 7. Late response after timeout is silently ignored (no crash)
  // -----------------------------------------------------------------------

  it('ignores a late response that arrives after timeout', async () => {
    const promise = client.sendCommand('Runtime.evaluate', {}, undefined, 200)

    const sent = JSON.parse(mockWs.send.mock.calls[0][0])

    // Let timeout fire and catch the rejection together
    const [, result] = await Promise.allSettled([
      vi.advanceTimersByTimeAsync(201),
      promise
    ])

    expect(result.status).toBe('rejected')
    expect((result as PromiseRejectedResult).reason.message).toContain(
      'timed out'
    )

    // Now the response arrives late — should not throw
    expect(() => {
      ;(client as any).handleMessage(
        JSON.stringify({id: sent.id, result: {value: 42}})
      )
    }).not.toThrow()
  })

  // -----------------------------------------------------------------------
  // 8. sessionId is included when provided
  // -----------------------------------------------------------------------

  it('includes sessionId in the command message', async () => {
    client.sendCommand('Runtime.evaluate', {expression: '1'}, 'session-abc')

    const sent = JSON.parse(mockWs.send.mock.calls[0][0])
    expect(sent.sessionId).toBe('session-abc')
  })

  // -----------------------------------------------------------------------
  // 9. send() throwing is handled gracefully
  // -----------------------------------------------------------------------

  it('rejects and cleans up when ws.send throws', async () => {
    mockWs.send.mockImplementation(() => {
      throw new Error('write after end')
    })

    await expect(client.sendCommand('Target.getTargets')).rejects.toThrow(
      'write after end'
    )

    // pendingRequests should be clean
    expect((client as any).pendingRequests.size).toBe(0)
  })
})
