import {describe, it, expect, vi, afterEach} from 'vitest'
import * as http from 'http'
import * as net from 'net'

import {
  discoverWebSocketDebuggerUrl,
  checkChromeRemoteDebugging
} from '../../run-chromium/chromium-source-inspection/discovery'

// ---------------------------------------------------------------------------
// Helpers — tiny HTTP server for testing discovery
// ---------------------------------------------------------------------------

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
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()))
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
    // Use a port that is (almost certainly) not in use
    // Get a free port by binding then releasing
    const server = net.createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as net.AddressInfo).port
    await new Promise<void>((r) => server.close(() => r()))

    const result = await checkChromeRemoteDebugging(port)
    expect(result).toBe(false)
  })
})
