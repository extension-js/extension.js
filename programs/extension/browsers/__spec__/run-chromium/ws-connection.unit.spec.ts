import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

// Shared state for mock WebSocket instances — must be declared before vi.mock
const wsInstances: any[] = []

vi.mock('ws', async () => {
  const {EventEmitter} = await import('events')

  class MockWebSocket extends EventEmitter {
    static OPEN = 1
    static CLOSED = 3
    readyState = 1

    constructor(_url: string) {
      super()
      wsInstances.push(this)
    }

    close() {
      ;(this as any).readyState = 3
    }

    send(_data: string) {}
  }
  return {default: MockWebSocket}
})

import {establishBrowserConnection} from '../../run-chromium/chromium-source-inspection/ws'

describe('establishBrowserConnection', () => {
  beforeEach(() => {
    wsInstances.length = 0
  })

  afterEach(() => {
    for (const ws of wsInstances) ws.removeAllListeners()
  })

  function getLastWs() {
    return wsInstances[wsInstances.length - 1]
  }

  // -----------------------------------------------------------------------
  // 1. Normal connection flow
  // -----------------------------------------------------------------------

  it('resolves with the WebSocket on successful open', async () => {
    const onMessage = vi.fn()
    const onRejectPending = vi.fn()

    const promise = establishBrowserConnection(
      'ws://127.0.0.1:9222/devtools/browser',
      false,
      onMessage,
      onRejectPending
    )

    const ws = getLastWs()
    ws.emit('open')

    const result = await promise
    expect(result).toBe(ws)
    expect(onRejectPending).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // 2. Error before open rejects the promise
  // -----------------------------------------------------------------------

  it('rejects once when error fires before open', async () => {
    const onMessage = vi.fn()
    const onRejectPending = vi.fn()

    const promise = establishBrowserConnection(
      'ws://127.0.0.1:9222/devtools/browser',
      false,
      onMessage,
      onRejectPending
    )

    const ws = getLastWs()
    ws.emit('error', new Error('ECONNREFUSED'))

    await expect(promise).rejects.toThrow('ECONNREFUSED')
    expect(onRejectPending).toHaveBeenCalledTimes(1)
    expect(onRejectPending).toHaveBeenCalledWith('ECONNREFUSED')
  })

  // -----------------------------------------------------------------------
  // 3. Error + close sequence — both call onRejectPending
  //    (WebSocket always fires close after error).
  //    The promise itself rejects only once.
  // -----------------------------------------------------------------------

  it('calls onRejectPending from both error and close handlers', async () => {
    const onMessage = vi.fn()
    const onRejectPending = vi.fn()

    const promise = establishBrowserConnection(
      'ws://127.0.0.1:9222/devtools/browser',
      false,
      onMessage,
      onRejectPending
    ).catch((e: unknown) => e) // prevent unhandled rejection

    const ws = getLastWs()
    ws.emit('error', new Error('socket hang up'))
    ws.emit('close')

    await promise
    expect(onRejectPending).toHaveBeenCalledTimes(2)
    expect(onRejectPending).toHaveBeenCalledWith('socket hang up')
    expect(onRejectPending).toHaveBeenCalledWith('CDP connection closed')
  })

  // -----------------------------------------------------------------------
  // 4. Close after successful open calls onRejectPending
  // -----------------------------------------------------------------------

  it('calls onRejectPending when connection closes after open', async () => {
    const onMessage = vi.fn()
    const onRejectPending = vi.fn()

    const promise = establishBrowserConnection(
      'ws://127.0.0.1:9222/devtools/browser',
      false,
      onMessage,
      onRejectPending
    )

    const ws = getLastWs()
    ws.emit('open')
    await promise

    // Unexpected close after connection is established
    ws.emit('close')

    expect(onRejectPending).toHaveBeenCalledTimes(1)
    expect(onRejectPending).toHaveBeenCalledWith('CDP connection closed')
  })

  // -----------------------------------------------------------------------
  // 5. Messages are forwarded to onMessage callback
  // -----------------------------------------------------------------------

  it('forwards messages via onMessage callback', async () => {
    const onMessage = vi.fn()
    const onRejectPending = vi.fn()

    const promise = establishBrowserConnection(
      'ws://127.0.0.1:9222/devtools/browser',
      false,
      onMessage,
      onRejectPending
    )

    const ws = getLastWs()
    ws.emit('open')
    await promise

    // Simulate incoming WS data (toString() is called by the handler)
    const data = {toString: () => '{"id":1,"result":{}}'}
    ws.emit('message', data)

    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage).toHaveBeenCalledWith('{"id":1,"result":{}}')
  })
})
