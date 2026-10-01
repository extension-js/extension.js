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
  resolveAllowedCorsOrigin
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
): Promise<{status: number; headers: http.IncomingHttpHeaders}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {host: '127.0.0.1', port, path: '/', method: 'GET', headers},
      (res) => {
        res.resume()
        res.once('end', () =>
          resolve({status: res.statusCode ?? 0, headers: res.headers})
        )
      }
    )
    req.once('error', reject)
    req.end()
  })
}

async function startServer() {
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
    emulatorOrigin: VIEWER_ORIGIN
  })

  const server = new RspackDevServer(
    {
      port: 0,
      host: '127.0.0.1',
      hot: true,
      client: false,
      static: false,
      allowedHosts: access.allowedHosts,
      headers: access.headers
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
})
