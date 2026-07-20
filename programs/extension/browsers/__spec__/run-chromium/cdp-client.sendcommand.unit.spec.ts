import {EventEmitter} from 'node:events'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import WebSocket from 'ws'

vi.mock('../../run-chromium/cdp/discovery', () => ({
  discoverWebSocketDebuggerUrl: vi.fn(
    async () => 'ws://127.0.0.1:9222/devtools/browser'
  ),
  checkChromeRemoteDebugging: vi.fn(async () => true)
}))

vi.mock('../../run-chromium/cdp/ws', () => ({
  establishBrowserConnection: vi.fn()
}))

import {CDPClient} from '../../run-chromium/cdp/cdp-client'

describe('CDPClient.sendCommand', () => {
  let client: CDPClient
  let mockWs: any

  beforeEach(() => {
    vi.useFakeTimers()
    client = new CDPClient(9222, '127.0.0.1')

    mockWs = new EventEmitter()
    mockWs.readyState = WebSocket.OPEN
    mockWs.close = vi.fn(() => {
      mockWs.readyState = WebSocket.CLOSED
    })
    mockWs.send = vi.fn()

    ;(client as any).ws = mockWs
  })

  afterEach(() => {
    vi.useRealTimers()
    try {
      client.disconnect()
    } catch {
      // Ignore
    }
  })

  it('resolves when a matching response arrives', async () => {
    const promise = client.sendCommand('Target.getTargets', {})

    expect(mockWs.send).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(mockWs.send.mock.calls[0][0])
    expect(sent.method).toBe('Target.getTargets')

    ;(client as any).handleMessage(
      JSON.stringify({id: sent.id, result: {targetInfos: [{type: 'page'}]}})
    )

    const result = await promise
    expect(result).toEqual({targetInfos: [{type: 'page'}]})
  })

  it('rejects with timeout error when no response arrives within timeoutMs', async () => {
    const promise = client.sendCommand(
      'Runtime.evaluate',
      {expression: '1+1'},
      undefined,
      500
    )

    const [, result] = await Promise.allSettled([
      vi.advanceTimersByTimeAsync(501),
      promise
    ])

    expect(result.status).toBe('rejected')
    expect((result as PromiseRejectedResult).reason.message).toContain(
      'CDP command timed out (500ms)'
    )
  })

  it('cancels the timeout when response arrives in time', async () => {
    const promise = client.sendCommand(
      'Page.navigate',
      {url: 'about:blank'},
      undefined,
      5000
    )

    const sent = JSON.parse(mockWs.send.mock.calls[0][0])

    ;(client as any).handleMessage(
      JSON.stringify({id: sent.id, result: {frameId: 'frame-1'}})
    )

    const result = await promise
    expect(result).toEqual({frameId: 'frame-1'})

    await vi.advanceTimersByTimeAsync(10000)
  })

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

  it('rejects immediately when WebSocket is not open', async () => {
    mockWs.readyState = WebSocket.CLOSED

    await expect(client.sendCommand('Target.getTargets')).rejects.toThrow(
      'CDP transport is not open'
    )
  })

  it('handles multiple concurrent commands with unique IDs', async () => {
    const p1 = client.sendCommand('Target.getTargets')
    const p2 = client.sendCommand('Browser.getVersion')

    expect(mockWs.send).toHaveBeenCalledTimes(2)
    const sent1 = JSON.parse(mockWs.send.mock.calls[0][0])
    const sent2 = JSON.parse(mockWs.send.mock.calls[1][0])

    expect(sent1.id).not.toBe(sent2.id)
    expect(sent1.method).toBe('Target.getTargets')
    expect(sent2.method).toBe('Browser.getVersion')

    ;(client as any).handleMessage(
      JSON.stringify({id: sent2.id, result: {product: 'Chrome/120'}})
    )
    ;(client as any).handleMessage(
      JSON.stringify({id: sent1.id, result: {targetInfos: []}})
    )

    await expect(p1).resolves.toEqual({targetInfos: []})
    await expect(p2).resolves.toEqual({product: 'Chrome/120'})
  })

  it('ignores a late response that arrives after timeout', async () => {
    const promise = client.sendCommand('Runtime.evaluate', {}, undefined, 200)

    const sent = JSON.parse(mockWs.send.mock.calls[0][0])

    const [, result] = await Promise.allSettled([
      vi.advanceTimersByTimeAsync(201),
      promise
    ])

    expect(result.status).toBe('rejected')
    expect((result as PromiseRejectedResult).reason.message).toContain(
      'timed out'
    )

    expect(() => {
      ;(client as any).handleMessage(
        JSON.stringify({id: sent.id, result: {value: 42}})
      )
    }).not.toThrow()
  })

  it('includes sessionId in the command message', async () => {
    client.sendCommand('Runtime.evaluate', {expression: '1'}, 'session-abc')

    const sent = JSON.parse(mockWs.send.mock.calls[0][0])
    expect(sent.sessionId).toBe('session-abc')
  })

  it('rejects and cleans up when ws.send throws', async () => {
    mockWs.send.mockImplementation(() => {
      throw new Error('write after end')
    })

    await expect(client.sendCommand('Target.getTargets')).rejects.toThrow(
      'write after end'
    )

    expect((client as any).pendingRequests.size).toBe(0)
  })
})
