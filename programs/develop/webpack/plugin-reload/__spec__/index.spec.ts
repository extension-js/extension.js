import {describe, it, expect, vi, beforeEach} from 'vitest'
import {Compiler} from '@rspack/core'

vi.mock('../steps/create-web-socket-server', () => {
  return {
    __esModule: true,
    default: class {
      apply = vi.fn()
      constructor(_: any) {}
    }
  }
})

vi.mock('../steps/setup-reload-strategy', () => {
  return {
    __esModule: true,
    default: class {
      apply = vi.fn()
      constructor(_: any) {}
    }
  }
})

vi.mock(
  '../../plugin-browsers/run-firefox/remote-firefox/setup-firefox-inspection',
  () => {
    return {
      SetupFirefoxInspectionStep: class {
        apply = vi.fn()
        constructor(_: any) {}
      }
    }
  }
)

import {ReloadPlugin} from '../index'

function makeCompiler(
  mode: 'development' | 'production' = 'development'
): Compiler {
  return {
    options: {mode, entry: {}, output: {path: '/tmp/out'}},
    hooks: {} as any
  } as any
}

describe('ReloadPlugin', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets currentInstance on compiler options when instanceId provided', () => {
    const plugin = new ReloadPlugin({
      manifestPath: '/a/manifest.json',
      instanceId: 'abc123'
    } as any)
    const compiler = makeCompiler('development')
    plugin.apply(compiler)
    expect((compiler.options as any).currentInstance).toEqual({
      instanceId: 'abc123'
    })
  })

  it('does nothing in non-development mode', () => {
    const plugin = new ReloadPlugin({manifestPath: '/a/manifest.json'} as any)
    const compiler = makeCompiler('production')
    // Should not throw; simply return
    plugin.apply(compiler)
    expect((compiler.options as any).currentInstance).toBeUndefined()
  })
})

describe('manager reload-service handshake', () => {
  it('should include ensureClientReadyHandshake in chrome manager extension', () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const base = path.join(
      __dirname,
      '..',
      'extensions',
      'chrome-manager-extension',
      'reload-service.js'
    )
    const content = fs.readFileSync(base, 'utf-8')
    expect(content).toMatch(/ensureClientReadyHandshake/)
  })
})
