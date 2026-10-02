import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {RspackDevServer} from '@rspack/dev-server'
import {afterAll, describe, expect, it} from 'vitest'
import {
  devServerAccessConfig,
  devServerCorsHeaders,
  parseAllowedHosts,
  refusedHostName,
  resolveAllowedCorsOrigin,
  withHostCheckMiddleware
} from '../cors'

const VIEWER_ORIGIN = 'https://browsers.extension.land'
const roots: string[] = []

function headerMap(origin: string | undefined, allowed: string[] = []) {
  return new Map(
    devServerCorsHeaders(origin, allowed).map(({key, value}) => [
      key.toLowerCase(),
      value
    ])
  )
}

function request(
  port: number,
  headers: Record<string, string>
): Promise<{status: number; headers: http.IncomingHttpHeaders; body: string}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {host: '127.0.0.1', port, path: '/', method: 'GET', headers},
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
        })

        res.once('end', () =>
          resolve({status: res.statusCode ?? 0, headers: res.headers, body})
        )
      }
    )
    req.once('error', reject)
    req.end()
  })
}

async function startServer(
  options: {allowedHosts?: string; onRefused?: (host: string) => void} = {}
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-devserver-cors-'))
  roots.push(root)
  fs.writeFileSync(path.join(root, 'index.js'), "console.log('cors')\n")

  const compiler = rspack({
    mode: 'development',
    context: root,
    entry: path.join(root, 'index.js'),
    output: {path: path.join(root, 'dist')},
    stats: false,
    infrastructureLogging: {level: 'none'}
  })

  const access = devServerAccessConfig({
    connectableHost: '127.0.0.1',
    emulatorOrigin: VIEWER_ORIGIN,
    allowedHosts: options.allowedHosts
  })

  const server = new RspackDevServer(
    {
      port: 0,
      host: '127.0.0.1',
      hot: true,
      client: false,
      static: false,
      allowedHosts: access.allowedHosts,
      headers: access.headers,
      setupMiddlewares: (middlewares: unknown[], devServer: unknown) =>
        withHostCheckMiddleware(
          middlewares,
          devServer,
          options.onRefused ?? (() => {})
        )
    } as never,
    compiler
  )
  await server.start()

  const address = (server.server as {address?(): unknown})?.address?.()
  const port =
    typeof address === 'object' && address
      ? (address as {port: number}).port
      : 0

  return {server, port}
}

describe('dev server allow-origin policy', () => {
  it('reflects the extension origin the hot client fetches from', () => {
    expect(resolveAllowedCorsOrigin('chrome-extension://abcdefgh')).toBe(
      'chrome-extension://abcdefgh'
    )

    expect(resolveAllowedCorsOrigin('moz-extension://abcdefgh')).toBe(
      'moz-extension://abcdefgh'
    )

    expect(resolveAllowedCorsOrigin('safari-web-extension://abcdefgh')).toBe(
      'safari-web-extension://abcdefgh'
    )
  })

  it('refuses every web origin the session did not ask for', () => {
    expect(resolveAllowedCorsOrigin('https://evil.test')).toBeNull()
    expect(resolveAllowedCorsOrigin('http://localhost:3000')).toBeNull()
    expect(resolveAllowedCorsOrigin('null')).toBeNull()
    expect(resolveAllowedCorsOrigin(undefined)).toBeNull()
    expect(resolveAllowedCorsOrigin(VIEWER_ORIGIN)).toBeNull()
    expect(
      resolveAllowedCorsOrigin('https://browsers.extension.land.evil.test', [
        VIEWER_ORIGIN
      ])
    ).toBeNull()
  })

  it('admits the emulator viewer origin only when that lane is on', () => {
    expect(resolveAllowedCorsOrigin(VIEWER_ORIGIN, [VIEWER_ORIGIN])).toBe(
      VIEWER_ORIGIN
    )

    expect(headerMap(VIEWER_ORIGIN, [VIEWER_ORIGIN])).toEqual(
      new Map([
        ['vary', 'Origin'],
        ['access-control-allow-origin', VIEWER_ORIGIN],
        ['access-control-allow-private-network', 'true']
      ])
    )
  })

  it('never answers with a star, and varies on the origin', () => {
    expect(headerMap('https://evil.test', [VIEWER_ORIGIN])).toEqual(
      new Map([['vary', 'Origin']])
    )

    expect(
      headerMap('chrome-extension://abcdefgh').get(
        'access-control-allow-origin'
      )
    ).toBe('chrome-extension://abcdefgh')

    expect(
      headerMap('chrome-extension://abcdefgh').has(
        'access-control-allow-private-network'
      )
    ).toBe(false)
  })

  it('adds the hosts the user allowed, from a comma list or an array', () => {
    expect(parseAllowedHosts(' web, api.internal ,,web ')).toEqual([
      'web',
      'api.internal'
    ])

    expect(parseAllowedHosts(['.ngrok.app', 'mymac.local'])).toEqual([
      '.ngrok.app',
      'mymac.local'
    ])

    expect(parseAllowedHosts(undefined)).toEqual([])

    expect(
      devServerAccessConfig({
        connectableHost: '127.0.0.1',
        allowedHosts: 'web,127.0.0.1,host.docker.internal'
      }).allowedHosts
    ).toEqual(['127.0.0.1', 'web', 'host.docker.internal'])
  })

  it('reduces a refused Host header to a name safe to print', () => {
    expect(refusedHostName('devbox.internal:8080')).toBe('devbox.internal')
    expect(refusedHostName('[::1]:8080')).toBe('[::1]')
    expect(refusedHostName('evil\u001b[31m.test')).not.toContain('\u001b')
    expect(refusedHostName(undefined)).toBe('')
  })

  it('names the hosts a session is dialed on instead of all', () => {
    expect(
      devServerAccessConfig({connectableHost: '127.0.0.1'}).allowedHosts
    ).toEqual(['127.0.0.1'])

    expect(
      devServerAccessConfig({
        connectableHost: 'dev.internal',
        emulatorOrigin: VIEWER_ORIGIN
      }).allowedHosts
    ).toEqual(['dev.internal', 'browsers.extension.land'])
  })
})

describe('dev server access config (real boot)', () => {
  afterAll(() => {
    for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
  })

  it('serves the extension and the viewer, never a visited web page', async () => {
    const {server, port} = await startServer()

    try {
      const extension = await request(port, {
        origin: 'chrome-extension://abcdefghijklmnop'
      })
      expect(extension.status).not.toBe(403)
      expect(extension.headers['access-control-allow-origin']).toBe(
        'chrome-extension://abcdefghijklmnop'
      )

      const viewer = await request(port, {origin: VIEWER_ORIGIN})
      expect(viewer.status).not.toBe(403)
      expect(viewer.headers['access-control-allow-origin']).toBe(VIEWER_ORIGIN)
      expect(viewer.headers['access-control-allow-private-network']).toBe(
        'true'
      )

      const page = await request(port, {origin: 'https://evil.test'})
      expect(page.headers['access-control-allow-origin']).toBeUndefined()

      // The Host-header check is what stops a name that resolves to loopback
      // from becoming same-origin with the dev server.
      const rebound = await request(port, {
        host: 'evil.test',
        origin: 'https://evil.test'
      })
      expect(rebound.status).toBe(403)
    } finally {
      await server.stop()
    }
  }, 120000)

  it('tells a refused host how to allow itself, once per host', async () => {
    const refused: string[] = []
    const {server, port} = await startServer({
      allowedHosts: 'web,.ngrok.app',
      onRefused: (host) => refused.push(host)
    })

    try {
      const first = await request(port, {host: 'devbox.internal:8080'})
      expect(first.status).toBe(403)
      expect(first.headers['content-type']).toContain('text/plain')
      expect(first.body).toContain('devbox.internal')
      expect(first.body).toContain('--allowed-hosts devbox.internal')
      expect(first.body).toContain('commands.dev.allowedHosts')

      const second = await request(port, {host: 'devbox.internal:8080'})
      expect(second.status).toBe(403)
      expect(refused).toEqual(['devbox.internal'])

      const other = await request(port, {host: 'mymac.local'})
      expect(other.status).toBe(403)
      expect(refused).toEqual(['devbox.internal', 'mymac.local'])

      // The allowed names answer, exact and by subdomain alike.
      const allowed = await request(port, {host: 'web:8080'})
      expect(allowed.status).not.toBe(403)
      const tunnel = await request(port, {host: 'abc.ngrok.app'})
      expect(tunnel.status).not.toBe(403)
      const loopback = await request(port, {host: 'localhost:8080'})
      expect(loopback.status).not.toBe(403)
      expect(refused).toHaveLength(2)
    } finally {
      await server.stop()
    }
  }, 120000)
})
