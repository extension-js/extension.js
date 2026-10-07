import {EventEmitter} from 'node:events'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import WebSocket from 'ws'

const discoverWebSocketDebuggerUrl = vi.fn()
const getExtensionInfo = vi.fn()

vi.mock('../../run-chromium/cdp/discovery', () => ({
  discoverWebSocketDebuggerUrl: (...args: unknown[]) =>
    discoverWebSocketDebuggerUrl(...args),
  checkChromeRemoteDebugging: vi.fn(async () => true)
}))

vi.mock('../../run-chromium/cdp/ws', () => ({
  establishBrowserConnection: vi.fn()
}))

vi.mock('../../run-chromium/cdp/extensions', () => ({
  getExtensionInfo: (...args: unknown[]) => getExtensionInfo(...args)
}))

import {CDPClient} from '../../run-chromium/cdp/cdp-client'
import {codedError} from '../../run-chromium/cdp/coded-error'
import {establishBrowserConnection} from '../../run-chromium/cdp/ws'

const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error as Error & {code?: string}
  )

describe('CDPClient error codes', () => {
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
    discoverWebSocketDebuggerUrl.mockReset()
    getExtensionInfo.mockReset()
    client.disconnect()
  })

  it('codes a command issued over a closed transport as E_CDP_NOT_CONNECTED', async () => {
    mockWs.readyState = WebSocket.CLOSED

    const error = await rejection(client.sendCommand('Target.getTargets'))

    expect(error?.message).toBe('CDP transport is not open')
    expect(error?.code).toBe('E_CDP_NOT_CONNECTED')
  })

  it('codes a command that never gets a reply as E_CDP_TIMEOUT', async () => {
    const promise = rejection(
      client.sendCommand('Runtime.evaluate', {expression: '1'}, undefined, 300)
    )

    await vi.advanceTimersByTimeAsync(301)
    const error = await promise

    expect(error?.message).toContain('CDP command timed out (300ms)')
    expect(error?.code).toBe('E_CDP_TIMEOUT')
  })

  it('codes a protocol error reply as E_CDP_OP_FAILED', async () => {
    const promise = rejection(
      client.sendCommand('Extensions.loadUnpacked', {extensionPath: '/bad'})
    )
    const sent = JSON.parse(mockWs.send.mock.calls[0][0])

    ;(client as any).handleMessage(
      JSON.stringify({
        id: sent.id,
        error: {code: -32000, message: 'Extension not found'}
      })
    )

    const error = await promise

    expect(error?.message).toContain('Extension not found')
    expect(error?.code).toBe('E_CDP_OP_FAILED')
  })

  it('codes an extension info failure as E_CDP_OP_FAILED', async () => {
    getExtensionInfo.mockRejectedValueOnce(new Error('no such extension'))

    const error = await rejection(client.getExtensionInfo('abcdefgh'))

    expect(error?.message).toContain('no such extension')
    expect(error?.code).toBe('E_CDP_OP_FAILED')
  })

  it('keeps the timeout code when the extension info command timed out', async () => {
    getExtensionInfo.mockRejectedValueOnce(
      codedError(
        'E_CDP_TIMEOUT',
        'CDP command timed out (10ms): Runtime.evaluate'
      )
    )

    const error = await rejection(client.getExtensionInfo('abcdefgh'))

    expect(error?.code).toBe('E_CDP_TIMEOUT')
  })

  it('codes a connect that found no endpoint as E_CDP_NOT_CONNECTED', async () => {
    discoverWebSocketDebuggerUrl.mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 127.0.0.1:9222')
    )

    const error = await rejection(new CDPClient(9222).connect())

    expect(error?.message).toContain('Failed to connect to CDP')
    expect(error?.code).toBe('E_CDP_NOT_CONNECTED')
  })

  it('keeps the timeout code when the endpoint discovery timed out', async () => {
    discoverWebSocketDebuggerUrl.mockRejectedValueOnce(
      codedError('E_CDP_TIMEOUT', 'CDP endpoint timed out: /json')
    )

    const error = await rejection(new CDPClient(9222).connect())

    expect(error?.message).toContain('CDP endpoint timed out: /json')
    expect(error?.code).toBe('E_CDP_TIMEOUT')
  })

  it('codes a command left pending when the socket closes as E_BROWSER_CONNECTION_CLOSED', async () => {
    discoverWebSocketDebuggerUrl.mockResolvedValueOnce(
      'ws://127.0.0.1:9222/devtools/browser'
    )

    let dropWire: ((reason: string) => void) | undefined
    vi.mocked(establishBrowserConnection).mockImplementationOnce(
      async (_url, _isDev, _onMessage, onRejectPending) => {
        dropWire = onRejectPending

        return mockWs
      }
    )

    const connected = new CDPClient(9222)
    await connected.connect()

    const promise = rejection(connected.sendCommand('Target.getTargets'))
    dropWire?.('CDP connection closed')
    const error = await promise
    connected.disconnect()

    expect(error?.message).toBe('CDP connection closed')
    expect(error?.code).toBe('E_BROWSER_CONNECTION_CLOSED')
  })

  it('codes a command left pending when the pipe closes as E_BROWSER_CONNECTION_CLOSED', async () => {
    const promise = rejection(client.sendCommand('Browser.getVersion'))

    ;(client as any).rejectAllPending('CDP pipe closed')
    const error = await promise

    expect(error?.message).toBe('CDP pipe closed')
    expect(error?.code).toBe('E_BROWSER_CONNECTION_CLOSED')
  })
})
