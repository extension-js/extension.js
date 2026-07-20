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
    const prev = process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST
    delete process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST
    try {
      const fakeCompiler = {
        options: {devServer: {host: '0.0.0.0', port: 8131, hot: 'only'}}
      }
      const [clientEntry] = getDevServerHmrImports(fakeCompiler as any)
      expect(clientEntry).toContain('hostname=127.0.0.1')
      expect(clientEntry).not.toContain('hostname=0.0.0.0')
    } finally {
      if (prev === undefined)
        delete process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST
      else process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST = prev
    }
  })

  it('prefers the resolved connectable host env over the bind host', () => {
    const prev = process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST
    process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST = 'devbox.example.com'
    try {
      const fakeCompiler = {
        options: {devServer: {host: '0.0.0.0', port: 8131, hot: 'only'}}
      }
      const [clientEntry] = getDevServerHmrImports(fakeCompiler as any)
      expect(clientEntry).toContain('hostname=devbox.example.com')
    } finally {
      if (prev === undefined)
        delete process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST
      else process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST = prev
    }
  })
})
