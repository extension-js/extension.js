import path from 'node:path'
import fs from 'node:fs'
import {describe, expect, it} from 'vitest'
import {getDevServerHmrImports} from '../dev-server-client-import'

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
})
