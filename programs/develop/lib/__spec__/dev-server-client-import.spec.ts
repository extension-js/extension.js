import path from 'node:path'
import fs from 'node:fs'
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

    // First entry is the dev-server client with query params
    const [clientEntry, hotEntry] = imports
    const clientPath = clientEntry.split('?')[0]

    // Both paths must be absolute — a bare specifier like
    // '@rspack/dev-server/client/index.js' would cause
    // "Module not found" errors in user monorepos.
    expect(
      path.isAbsolute(clientPath),
      `HMR client path must be absolute, got: ${clientPath}`
    ).toBe(true)
    expect(
      path.isAbsolute(hotEntry),
      `HMR hot path must be absolute, got: ${hotEntry}`
    ).toBe(true)

    // Both files must actually exist on disk
    expect(
      fs.existsSync(clientPath),
      `HMR client file missing: ${clientPath}`
    ).toBe(true)
    expect(fs.existsSync(hotEntry), `HMR hot file missing: ${hotEntry}`).toBe(
      true
    )
  })

  it('resolves the hot runtime from @rspack/core, a declared dependency (issue #486)', () => {
    // The HMR runtime must come from a package extension-develop actually
    // declares. The historical `webpack/hot/dev-server` request only resolved
    // on npm, where `webpack` was incidentally hoisted in as a transitive peer;
    // pnpm's strict store and Yarn PnP both reject it, breaking `extension dev`
    // with "Can't resolve 'webpack/hot/dev-server'". `@rspack/core` ships
    // `hot/dev-server.js` and is a direct dependency, so it resolves everywhere.
    const fakeCompiler = {
      options: {devServer: {host: '127.0.0.1', port: 8080, hot: 'only'}}
    }
    const [, hotEntry] = getDevServerHmrImports(fakeCompiler as any)
    const posix = hotEntry.replace(/\\/g, '/')
    expect(posix).toContain('@rspack/core/hot/dev-server')
    expect(posix).not.toContain('/webpack/hot/')
  })

  it('every prepended HMR specifier roots in a declared dependency (issue #486 guard)', () => {
    // The invariant that makes #486 non-repeatable, independent of any package
    // manager's hoisting: both specifiers extension-develop injects into user
    // entry chains must root in a package it DECLARES. This fails at the source
    // the moment anyone reintroduces an undeclared package (e.g. `webpack/...`),
    // whereas an install-based gate can pass by hoisting accident (npm's flat
    // tree, pnpm's public store) and only breaks in the field under Yarn PnP.
    const pkg = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'package.json'),
        'utf8'
      )
    )
    const declared = new Set(Object.keys(pkg.dependencies || {}))

    // Package root of a bare specifier: `@scope/name/sub` -> `@scope/name`,
    // `name/sub` -> `name`.
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
      // The browser cannot dial 0.0.0.0 — it must be rewritten to loopback.
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
