import * as http from 'node:http'
import {afterEach, describe, expect, it} from 'vitest'
import {discoverWebSocketDebuggerUrl} from '../../run-chromium/cdp/discovery'

describe('discoverWebSocketDebuggerUrl', () => {
  let server: http.Server | null = null

  afterEach(async () => {
    if (!server) return

    await new Promise<void>((resolve) => server!.close(() => resolve()))
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

    await new Promise<void>((resolve) =>
      server!.listen(0, '127.0.0.1', () => resolve())
    )

    const address = server.address()
    const port =
      typeof address === 'object' && address?.port ? address.port : null

    expect(port).toBeTruthy()

    const startedAt = Date.now()
    const wsUrl = await discoverWebSocketDebuggerUrl('127.0.0.1', port!, false)
    const elapsedMs = Date.now() - startedAt

    expect(wsUrl).toBe('ws://127.0.0.1/devtools/page/abc')
    expect(elapsedMs).toBeLessThan(5000)
  })

  it('codes an endpoint that never answers as E_CDP_TIMEOUT', async () => {
    server = http.createServer(() => {})

    await new Promise<void>((resolve) =>
      server!.listen(0, '127.0.0.1', () => resolve())
    )

    const address = server.address()
    const port =
      typeof address === 'object' && address?.port ? address.port : null

    expect(port).toBeTruthy()

    const error = await discoverWebSocketDebuggerUrl(
      '127.0.0.1',
      port!,
      false
    ).then(
      () => null,
      (reason: unknown) => reason as Error & {code?: string}
    )

    expect(error?.message).toBe('CDP endpoint timed out: /json')
    expect(error?.code).toBe('E_CDP_TIMEOUT')
  }, 10000)
})
