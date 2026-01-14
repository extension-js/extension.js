import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

// Mocks
const defineApply = vi.fn()
vi.mock('@rspack/core', () => {
  class DefinePluginMock {
    public args: any
    constructor(args: any) {
      this.args = args
    }
    apply = defineApply
  }
  class RawSourceMock {
    private content: string
    constructor(content: string) {
      this.content = content
    }
    source() {
      return this.content
    }
    size() {
      return this.content.length
    }
  }
  return {
    DefinePlugin: DefinePluginMock,
    Compilation: {PROCESS_ASSETS_STAGE_SUMMARIZE: 1000},
    sources: {RawSource: RawSourceMock}
  }
})

vi.mock('fs', async () => {
  const actual: any = await vi.importActual('fs')
  return {
    ...actual,
    existsSync: vi.fn()
  }
})
import * as fs from 'fs'
import * as dotenv from 'dotenv'

vi.mock('dotenv', () => ({
  config: vi.fn((opts: any) => {
    if (!opts || !opts.path) return {parsed: {}}
    if (String(opts.path).endsWith('.env.defaults')) {
      return {parsed: {EXTENSION_PUBLIC_FOO: 'defFoo', EXTENSION_BAZ: 'defBaz'}}
    }
    return {parsed: {EXTENSION_PUBLIC_FOO: 'envFoo', EXTENSION_BAR: 'envBar'}}
  })
}))

import {EnvPlugin} from '../env'

describe('EnvPlugin', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    defineApply.mockReset()
    ;(fs.existsSync as unknown as (p: any) => boolean) = vi.fn((p: any) => {
      const path = String(p)
      return (
        path.endsWith('/.env.chrome.development') ||
        path.endsWith('/.env.defaults') ||
        path.endsWith('/.env') ||
        path.endsWith('/.env.local')
      )
    })

    process.env.EXTENSION_PUBLIC_FOO = 'sysFoo'
    process.env.EXTENSION_QUX = 'sysQux'
  })

  afterEach(() => {
    delete process.env.EXTENSION_PUBLIC_FOO
    delete process.env.EXTENSION_QUX
    vi.restoreAllMocks()
  })

  function createCompiler(mode: 'development' | 'production' = 'development') {
    let thisCompilationCb: any
    const compiler: any = {
      options: {mode},
      hooks: {
        thisCompilation: {
          tap: (_name: string, cb: any) => {
            thisCompilationCb = cb
          }
        }
      }
    }
    const triggerCompilation = (compilation: any) =>
      thisCompilationCb(compilation)
    return {compiler, triggerCompilation}
  }

  function createCompilationWithAssets(files: Record<string, string>) {
    let processAssetsCb: any
    const updated: Record<string, string> = {}
    const compilation: any = {
      assets: Object.fromEntries(
        Object.entries(files).map(([k, v]) => [
          k,
          {
            source: () => v,
            size: () => v.length
          }
        ])
      ),
      hooks: {
        processAssets: {
          tap: (_opts: any, cb: any) => {
            processAssetsCb = cb
          }
        }
      },
      updateAsset: (name: string, raw: any) => {
        updated[name] = raw.source()
      }
    }
    return {
      compilation,
      runProcessAssets: () => processAssetsCb({}) as void,
      updated
    }
  }

  it('applies DefinePlugin with filtered env vars and defaults', async () => {
    const {compiler, triggerCompilation} = createCompiler('development')
    const plugin = new EnvPlugin({
      manifestPath: '/proj/manifest.json',
      browser: 'chrome'
    })
    plugin.apply(compiler as any)

    // Ensure DefinePlugin applied at least once
    expect(defineApply).toHaveBeenCalled()
  })

  it('replaces $EXTENSION_* and $EXTENSION_PUBLIC_* in json/html assets', async () => {
    const {compiler, triggerCompilation} = createCompiler('development')
    const plugin = new EnvPlugin({
      manifestPath: '/proj/manifest.json',
      browser: 'chrome'
    })
    plugin.apply(compiler as any)

    const {compilation, runProcessAssets, updated} =
      createCompilationWithAssets({
        'index.html':
          '<meta content="$EXTENSION_PUBLIC_FOO"><p>$EXTENSION_BAR $EXTENSION_MISS</p>',
        'manifest.json':
          '{"name":"$EXTENSION_PUBLIC_FOO","desc":"$EXTENSION_BAR"}',
        'ignore.txt': '$EXTENSION_PUBLIC_FOO'
      })

    triggerCompilation(compilation)
    runProcessAssets()

    // index.html and manifest.json updated, ignore.txt untouched
    expect(Object.keys(updated)).toEqual(['index.html', 'manifest.json'])
    expect(updated['index.html']).toContain('sysFoo') // from process.env override
    expect(updated['index.html']).toContain('envBar') // from env file
    expect(updated['index.html']).toContain('$EXTENSION_MISS') // untouched when missing
    expect(updated['manifest.json']).toContain('sysFoo')
    expect(updated['manifest.json']).toContain('envBar')
  })
})

