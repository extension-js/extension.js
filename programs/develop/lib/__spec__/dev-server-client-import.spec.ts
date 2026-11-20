import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  getDevServerHmrImports,
  HMR_CLIENT_SPECIFIER,
  HMR_HOT_SPECIFIER
} from '../dev-server-client-import'

describe('dev-server-client-import', () => {
  it('returns absolute paths that exist on disk (not bare specifiers)', () => {
    const fakeCompiler = {
      options: {
        devServer: {
          host: '127.0.0.1',
          port: 8080,
          hot: 'only'
        }
      }
    }

    const imports = getDevServerHmrImports(fakeCompiler as any)

    expect(imports).toHaveLength(2)

    const [clientEntry, hotEntry] = imports
    const clientPath = clientEntry.split('?')[0]

    expect(
      path.isAbsolute(clientPath),
      `HMR client path must be absolute, got: ${clientPath}`
    ).toBe(true)

    expect(
      path.isAbsolute(hotEntry),
      `HMR hot path must be absolute, got: ${hotEntry}`
    ).toBe(true)

    expect(
      fs.existsSync(clientPath),
      `HMR client file missing: ${clientPath}`
    ).toBe(true)

    expect(fs.existsSync(hotEntry), `HMR hot file missing: ${hotEntry}`).toBe(
      true
    )
  })

  it('resolves the hot runtime from @rspack/core, a declared dependency (issue #486)', () => {
    const fakeCompiler = {
      options: {devServer: {host: '127.0.0.1', port: 8080, hot: 'only'}}
    }
    const [, hotEntry] = getDevServerHmrImports(fakeCompiler as any)
    const posix = hotEntry.replace(/\\/g, '/')
    expect(posix).toContain('@rspack/core/hot/dev-server')
    expect(posix).not.toContain('/webpack/hot/')
  })

  it('every prepended HMR specifier roots in a declared dependency (issue #486 guard)', () => {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'package.json'),
        'utf8'
      )
    )
    const declared = new Set(Object.keys(pkg.dependencies || {}))

    const packageRoot = (spec: string): string => {
      const parts = spec.split('/')

      return spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
    }

    for (const spec of [HMR_CLIENT_SPECIFIER, HMR_HOT_SPECIFIER]) {
      const root = packageRoot(spec)
      expect(
        declared.has(root),
        `HMR specifier "${spec}" roots in "${root}", which is NOT a declared ` +
          `dependency of extension-develop. It would only resolve by hoisting ` +
          `accident and break under Yarn PnP / pnpm strict (issue #486). Add it ` +
          `to programs/develop/package.json dependencies or use a declared one.`
      ).toBe(true)
    }
  })

  it('returns empty array when no devServer config and no env vars', () => {
    const fakeCompiler = {
      options: {}
    }

    const imports = getDevServerHmrImports(fakeCompiler as any)
    expect(imports).toEqual([])
  })

  it('client entry includes websocket query parameters', () => {
    const fakeCompiler = {
      options: {
        devServer: {
          host: 'localhost',
          port: 9090,
          hot: true,
          liveReload: false
        }
      }
    }

    const [clientEntry] = getDevServerHmrImports(fakeCompiler as any)
    expect(clientEntry).toContain('hostname=localhost')
    expect(clientEntry).toContain('port=9090')
    expect(clientEntry).toContain('hot=true')
    expect(clientEntry).toContain('live-reload=false')
  })

  it('rewrites a wildcard bind host to a connectable loopback host', () => {
    const fakeCompiler = {
      options: {devServer: {host: '0.0.0.0', port: 8131, hot: 'only'}}
    }
    const [clientEntry] = getDevServerHmrImports(fakeCompiler as any)

    expect(clientEntry).toContain('hostname=127.0.0.1')
    expect(clientEntry).not.toContain('hostname=0.0.0.0')
  })

  // Two sessions in one host: the environment holds what the newest wrote.
  it('dials the socket of its own session, whatever another one left in the environment', () => {
    const names = ['PROTOCOL', 'HOST', 'CONNECTABLE_HOST', 'PORT', 'PATH']
    const kept = names.map(
      (name) => process.env[`EXTENSION_DEV_SERVER_${name}`]
    )

    process.env.EXTENSION_DEV_SERVER_PROTOCOL = 'wss'
    process.env.EXTENSION_DEV_SERVER_HOST = '0.0.0.0'
    process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST = 'other.example.com'
    process.env.EXTENSION_DEV_SERVER_PORT = '9191'
    process.env.EXTENSION_DEV_SERVER_PATH = '/ws/other-session'

    try {
      const [clientEntry] = getDevServerHmrImports({options: {}} as any, {
        protocol: 'ws',
        host: '127.0.0.1',
        connectableHost: '127.0.0.1',
        port: 8080,
        path: '/ws/this-session'
      })
      const query = new URLSearchParams(clientEntry.split('?')[1])

      expect(Object.fromEntries(query)).toMatchObject({
        protocol: 'ws',
        hostname: '127.0.0.1',
        port: '8080',
        pathname: '/ws/this-session'
      })
    } finally {
      names.forEach((name, index) => {
        const key = `EXTENSION_DEV_SERVER_${name}`

        if (kept[index] === undefined) delete process.env[key]
        else process.env[key] = kept[index]
      })
    }
  })

  it('prefers the connectable host of its session over the bind host', () => {
    const fakeCompiler = {
      options: {devServer: {host: '0.0.0.0', port: 8131, hot: 'only'}}
    }
    const [clientEntry] = getDevServerHmrImports(fakeCompiler as any, {
      connectableHost: 'devbox.example.com'
    })

    expect(clientEntry).toContain('hostname=devbox.example.com')
  })

  it('gives no client to a compiler only the environment names a session for', () => {
    const kept = [
      process.env.EXTENSION_DEV_SERVER_HOST,
      process.env.EXTENSION_DEV_SERVER_PORT
    ]

    process.env.EXTENSION_DEV_SERVER_HOST = '127.0.0.1'
    process.env.EXTENSION_DEV_SERVER_PORT = '9090'

    try {
      expect(getDevServerHmrImports({options: {}} as any)).toEqual([])
    } finally {
      if (kept[0] === undefined) delete process.env.EXTENSION_DEV_SERVER_HOST
      else process.env.EXTENSION_DEV_SERVER_HOST = kept[0]

      if (kept[1] === undefined) delete process.env.EXTENSION_DEV_SERVER_PORT
      else process.env.EXTENSION_DEV_SERVER_PORT = kept[1]
    }
  })
})
