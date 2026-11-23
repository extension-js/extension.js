import * as http from 'node:http'
import * as net from 'node:net'
import {afterEach, describe, expect, it} from 'vitest'

import {
  checkChromeRemoteDebugging,
  discoverWebSocketDebuggerUrl
} from '../../run-chromium/cdp/discovery'

function createCdpServer(
  handlers: Record<string, (res: http.ServerResponse) => void>
): Promise<{server: http.Server; port: number}> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url || ''

      if (Object.hasOwn(handlers, url)) {
        handlers[url](res)
      } else {
        res.writeHead(404)
        res.end('not found')
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo
      resolve({server, port: addr.port})
    })
  })
}

describe('discoverWebSocketDebuggerUrl', () => {
  let server: http.Server | undefined

  afterEach(async () => {
    const open = server

    if (open) {
      await new Promise<void>((r) => open.close(() => r()))
      server = undefined
    }
  })

  it('returns wsUrl from /json/version when available', async () => {
    const state = await createCdpServer({
      '/json/version': (res) => {
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(
          JSON.stringify({
            webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc'
          })
        )
      }
    })
    server = state.server

    const url = await discoverWebSocketDebuggerUrl(
      '127.0.0.1',
      state.port,
      false
    )
    expect(url).toBe('ws://127.0.0.1:9222/devtools/browser/abc')
  })

  it('falls back to /json when /json/version has no webSocketDebuggerUrl', async () => {
    const state = await createCdpServer({
      '/json/version': (res) => {
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({Browser: 'Chrome/120'}))
      },
      '/json': (res) => {
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(
          JSON.stringify([
            {
              type: 'page',
              webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/def'
            }
          ])
        )
      }
    })
    server = state.server

    const url = await discoverWebSocketDebuggerUrl(
      '127.0.0.1',
      state.port,
      false
    )
    expect(url).toBe('ws://127.0.0.1:9222/devtools/page/def')
  })

  it('falls back to /json when /json/version errors', async () => {
    const state = await createCdpServer({
      '/json/version': (res) => {
        res.writeHead(500)
        res.end('internal error')
      },
      '/json': (res) => {
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(
          JSON.stringify([
            {
              type: 'page',
              webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/fallback'
            }
          ])
        )
      }
    })
    server = state.server

    const url = await discoverWebSocketDebuggerUrl(
      '127.0.0.1',
      state.port,
      false
    )
    expect(url).toBe('ws://127.0.0.1:9222/devtools/page/fallback')
  })

  it('throws when neither endpoint provides a WebSocket URL', async () => {
    const state = await createCdpServer({
      '/json/version': (res) => {
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({}))
      },
      '/json': (res) => {
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(JSON.stringify([]))
      }
    })
    server = state.server

    await expect(
      discoverWebSocketDebuggerUrl('127.0.0.1', state.port, false)
    ).rejects.toThrow('No CDP WebSocket URL available')
  })

  it('codes a missing WebSocket URL as E_CDP_NOT_CONNECTED', async () => {
    const state = await createCdpServer({
      '/json/version': (res) => {
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({}))
      },
      '/json': (res) => {
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(JSON.stringify([{type: 'background_page'}]))
      }
    })
    server = state.server

    const error = await discoverWebSocketDebuggerUrl(
      '127.0.0.1',
      state.port,
      false
    ).then(
      () => null,
      (reason: unknown) => reason as Error & {code?: string}
    )

    expect(error?.code).toBe('E_CDP_NOT_CONNECTED')
  })

  it('skips non-page targets when falling back to /json', async () => {
    const state = await createCdpServer({
      '/json/version': (res) => {
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({}))
      },
      '/json': (res) => {
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(
          JSON.stringify([
            {type: 'service_worker', webSocketDebuggerUrl: 'ws://sw'},
            {type: 'page', webSocketDebuggerUrl: 'ws://page'}
          ])
        )
      }
    })
    server = state.server

    const url = await discoverWebSocketDebuggerUrl(
      '127.0.0.1',
      state.port,
      false
    )
    expect(url).toBe('ws://page')
  })

  it('handles non-JSON response from /json/version gracefully', async () => {
    const state = await createCdpServer({
      '/json/version': (res) => {
        res.writeHead(200)
        res.end('this is not json')
      },
      '/json': (res) => {
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(
          JSON.stringify([
            {type: 'page', webSocketDebuggerUrl: 'ws://fallback-page'}
          ])
        )
      }
    })
    server = state.server

    const url = await discoverWebSocketDebuggerUrl(
      '127.0.0.1',
      state.port,
      false
    )
    expect(url).toBe('ws://fallback-page')
  })

  it('passes over a WebSocket URL in a 500 answer and asks the fallback endpoint', async () => {
    const state = await createCdpServer({
      '/json/version': (res) => {
        res.writeHead(500, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({webSocketDebuggerUrl: 'ws://from-a-500'}))
      },
      '/json': (res) => {
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(
          JSON.stringify([
            {type: 'page', webSocketDebuggerUrl: 'ws://page-200'}
          ])
        )
      }
    })
    server = state.server

    const url = await discoverWebSocketDebuggerUrl(
      '127.0.0.1',
      state.port,
      false
    )
    expect(url).toBe('ws://page-200')
  })

  it.each([
    500, 201, 404
  ])('refuses a page target in a %i answer on the fallback endpoint', async (status) => {
    const state = await createCdpServer({
      '/json': (res) => {
        res.writeHead(status, {'Content-Type': 'application/json'})
        res.end(
          JSON.stringify([
            {type: 'page', webSocketDebuggerUrl: 'ws://page-not-200'}
          ])
        )
      }
    })
    server = state.server

    const error = await discoverWebSocketDebuggerUrl(
      '127.0.0.1',
      state.port,
      false
    ).then(
      () => null,
      (reason: unknown) => reason as Error & {code?: string}
    )

    expect(error?.message).toBe(`CDP endpoint /json answered HTTP ${status}`)
    expect(error?.code).toBe('E_CDP_NOT_CONNECTED')
  })
})

describe('checkChromeRemoteDebugging', () => {
  it('returns true when a server is listening on the port', async () => {
    const server = net.createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as net.AddressInfo).port

    try {
      const result = await checkChromeRemoteDebugging(port)
      expect(result).toBe(true)
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })

  it('returns false when nothing is listening on the port', async () => {
    const server = net.createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as net.AddressInfo).port
    await new Promise<void>((r) => server.close(() => r()))

    const result = await checkChromeRemoteDebugging(port)
    expect(result).toBe(false)
  })

  it('accepts a custom host parameter', async () => {
    const server = net.createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as net.AddressInfo).port

    try {
      const result = await checkChromeRemoteDebugging(port, '127.0.0.1')
      expect(result).toBe(true)
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })

  // Loopback only: an address off this machine would leave the test's reach.
  it('returns false for a custom host whose port is closed', async () => {
    const server = net.createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as net.AddressInfo).port
    await new Promise<void>((r) => server.close(() => r()))

    expect(await checkChromeRemoteDebugging(port, '127.0.0.1')).toBe(false)
  })
})
