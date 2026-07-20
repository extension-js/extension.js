import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const wsInstances: any[] = []

vi.mock('ws', async () => {
  const {EventEmitter} = await import('node:events')

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

import {establishBrowserConnection} from '../../run-chromium/cdp/ws'

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

  it('calls onRejectPending from both error and close handlers', async () => {
    const onMessage = vi.fn()
    const onRejectPending = vi.fn()

    const promise = establishBrowserConnection(
      'ws://127.0.0.1:9222/devtools/browser',
      false,
      onMessage,
      onRejectPending
    ).catch((e: unknown) => e)

    const ws = getLastWs()
    ws.emit('error', new Error('socket hang up'))
    ws.emit('close')

    await promise
    expect(onRejectPending).toHaveBeenCalledTimes(2)
    expect(onRejectPending).toHaveBeenCalledWith('socket hang up')
    expect(onRejectPending).toHaveBeenCalledWith('CDP connection closed')
  })

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

    ws.emit('close')

    expect(onRejectPending).toHaveBeenCalledTimes(1)
    expect(onRejectPending).toHaveBeenCalledWith('CDP connection closed')
  })

  it('rejects when the socket closes before it opens', async () => {
    const onMessage = vi.fn()
    const onRejectPending = vi.fn()

    const promise = establishBrowserConnection(
      'ws://127.0.0.1:9222/devtools/browser',
      false,
      onMessage,
      onRejectPending
    )

    const ws = getLastWs()
    ws.emit('close')

    await expect(promise).rejects.toThrow(/closed before/)
    expect(onRejectPending).toHaveBeenCalledWith('CDP connection closed')
  })

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

    const data = {toString: () => '{"id":1,"result":{}}'}
    ws.emit('message', data)

    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage).toHaveBeenCalledWith('{"id":1,"result":{}}')
  })
})
