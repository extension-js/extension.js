import * as http from 'node:http'
import type {AddressInfo} from 'node:net'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {defined} from '../../../__spec__/helpers/defined'
import {CDP_HTTP_TIMEOUT_MS} from '../../browsers-lib/constants'
import {discoverWebSocketDebuggerUrl} from '../../run-chromium/cdp/discovery'

describe('discoverWebSocketDebuggerUrl', () => {
  let server: http.Server | null = null

  afterEach(async () => {
    const open = server

    if (!open) return

    await new Promise<void>((resolve) => open.close(() => resolve()))
    server = null
  })

  it('falls back to /json when /json/version hangs', async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/json/version') {
        return
      }

      if (req.url === '/json') {
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(
          JSON.stringify([
            {
              type: 'page',
              webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/abc'
            }
          ])
        )

        return
      }

      res.writeHead(404)
      res.end()
    })

    const listening = server

    await new Promise<void>((resolve) =>
      listening.listen(0, '127.0.0.1', () => resolve())
    )

    const address = server.address()
    const port =
      typeof address === 'object' && address?.port ? address.port : null

    expect(port).toBeTruthy()

    const startedAt = Date.now()
    const wsUrl = await discoverWebSocketDebuggerUrl(
      '127.0.0.1',
      defined(port, 'the port the server listens on'),
      false,
      100
    )
    const elapsedMs = Date.now() - startedAt

    expect(wsUrl).toBe('ws://127.0.0.1/devtools/page/abc')
    expect(elapsedMs).toBeGreaterThanOrEqual(90)
    expect(elapsedMs).toBeLessThan(5000)
  })

  it('gives each request 1.2 seconds when the caller names no timeout', async () => {
    const answering = http.createServer((_req, res) => {
      res.writeHead(200, {'Content-Type': 'application/json'})
      res.end(
        JSON.stringify({webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/x'})
      )
    })

    server = answering
    await new Promise<void>((resolve) =>
      answering.listen(0, '127.0.0.1', () => resolve())
    )

    const {port} = answering.address() as AddressInfo
    const armed = vi.spyOn(http.ClientRequest.prototype, 'setTimeout')

    try {
      await expect(
        discoverWebSocketDebuggerUrl('127.0.0.1', port, false)
      ).resolves.toBe('ws://127.0.0.1/devtools/x')

      expect(armed.mock.calls.map((call) => call[0])).toEqual([1200])
      expect(CDP_HTTP_TIMEOUT_MS).toBe(1200)
    } finally {
      armed.mockRestore()
    }
  })

  it('codes an endpoint that never answers as E_CDP_TIMEOUT', async () => {
    server = http.createServer(() => {})

    const listening = server

    await new Promise<void>((resolve) =>
      listening.listen(0, '127.0.0.1', () => resolve())
    )

    const address = server.address()
    const port =
      typeof address === 'object' && address?.port ? address.port : null

    expect(port).toBeTruthy()

    const error = await discoverWebSocketDebuggerUrl(
      '127.0.0.1',
      defined(port, 'the port the server listens on'),
      false,
      100
    ).then(
      () => null,
      (reason: unknown) => reason as Error & {code?: string}
    )

    expect(error?.message).toBe('CDP endpoint timed out: /json')
    expect(error?.code).toBe('E_CDP_TIMEOUT')
  }, 10000)
})
