import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, expect, it, beforeEach, afterEach, vi} from 'vitest'

function createCompiler(mode: 'development' | 'production' = 'development') {
  const hooks: any = {}
  return {
    options: {entry: {}, mode},
    hooks,
    webpack: {
      RuntimeGlobals: {publicPath: 'publicPath'},
      Template: {},
      RuntimeModule: {}
    }
  } as any
}

let recordedSpies: string[] = []

describe('ScriptsPlugin', () => {
  let tmp: string
  let manifestPath: string
  beforeEach(() => {
    vi.resetModules()
    recordedSpies = []
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-'))
    manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify({manifest_version: 3}))
  })
  afterEach(() => {
    try {
      fs.rmSync(tmp, {recursive: true, force: true})
    } catch {}
  })

  it('skips apply if manifest path is invalid', async () => {
    const compiler = createCompiler('development')
    const {ScriptsPlugin} = await import('..')
    const plugin = new ScriptsPlugin({manifestPath: '/not/found.json'} as any)
    plugin.apply(compiler)
    expect(compiler.options.entry).toEqual({})
  })

  it('applies steps in development', async () => {
    const compiler = createCompiler('development')

    vi.mock('../steps/add-scripts', () => ({
      AddScripts: class {
        apply = vi.fn()
        constructor() {
          recordedSpies.push('AddScripts')
        }
      }
    }))
    vi.mock('../steps/add-public-path-runtime-module', () => ({
      AddPublicPathRuntimeModule: class {
        apply = vi.fn()
        constructor() {
          recordedSpies.push('AddPublicPathRuntimeModule')
        }
      }
    }))
    vi.mock('../steps/setup-reload-strategy', () => ({
      SetupReloadStrategy: class {
        apply = vi.fn()
        constructor() {
          recordedSpies.push('SetupReloadStrategy')
        }
      }
    }))
    vi.mock('../steps/add-centralized-logger-script', () => ({
      AddCentralizedLoggerScript: class {
        apply = vi.fn()
        constructor() {
          recordedSpies.push('AddCentralizedLoggerScript')
        }
      }
    }))

    const {ScriptsPlugin: MockedPlugin} = await import('..')
    const p = new MockedPlugin({manifestPath} as any)
    p.apply(compiler)
    expect(recordedSpies).toEqual([
      'AddScripts',
      'SetupReloadStrategy',
      'AddCentralizedLoggerScript'
    ])
  })

  it('applies AddScripts and runtime module in production', async () => {
    const compiler = createCompiler('production')
    vi.mock('../steps/add-scripts', () => ({
      AddScripts: class {
        apply = vi.fn()
        constructor() {
          recordedSpies.push('AddScripts')
        }
      }
    }))
    vi.mock('../steps/add-public-path-runtime-module', () => ({
      AddPublicPathRuntimeModule: class {
        apply = vi.fn()
        constructor() {
          recordedSpies.push('AddPublicPathRuntimeModule')
        }
      }
    }))
    const {ScriptsPlugin: MockedPlugin} = await import('..')
    const p = new MockedPlugin({manifestPath} as any)
    p.apply(compiler)
    expect(recordedSpies).toEqual(['AddScripts', 'AddPublicPathRuntimeModule'])
  })
})
