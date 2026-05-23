import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

// Mocks
const defineApply = vi.fn()
let lastDefineArgs: any = null
const provideApply = vi.fn()
let lastProvideArgs: any = null
vi.mock('@rspack/core', () => {
  class DefinePluginMock {
    public args: any
    constructor(args: any) {
      this.args = args
      lastDefineArgs = args
    }
    apply = defineApply
  }
  class ProvidePluginMock {
    public args: any
    constructor(args: any) {
      this.args = args
      lastProvideArgs = args
    }
    apply = provideApply
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
    ProvidePlugin: ProvidePluginMock,
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
    const envPath = toPosix(String(opts.path))
    if (envPath.endsWith('/repo/.env')) {
      return {
        parsed: {
          EXTENSION_PUBLIC_ROOT_ONLY: 'rootOnly',
          EXTENSION_PUBLIC_FOO: 'rootFoo',
          EXTENSION_BAR: 'rootBar'
        }
      }
    }
    if (envPath.endsWith('.env.defaults')) {
      return {
        parsed: {EXTENSION_PUBLIC_FOO: 'defFoo', EXTENSION_BAZ: 'defBaz'}
      }
    }
    return {
      parsed: {EXTENSION_PUBLIC_FOO: 'envFoo', EXTENSION_BAR: 'envBar'}
    }
  })
}))

import {EnvPlugin} from '../env'
import {getCurrentManifestContent} from '../../plugin-web-extension/feature-manifest/manifest-lib/manifest'

const toPosix = (value: string) => value.replace(/\\/g, '/')

describe('EnvPlugin', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    defineApply.mockReset()
    provideApply.mockReset()
    lastProvideArgs = null
    ;(fs.existsSync as unknown as (p: any) => boolean) = vi.fn((p: any) => {
      const path = toPosix(String(p))
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
    expect(lastDefineArgs).toBeTruthy()
    // The process shim isn't resolvable here (fs.existsSync mocked to .env
    // paths only), so the inline fallback stub is defined for browser safety.
    expect(lastDefineArgs['process']).toBeTruthy()
    expect(lastDefineArgs['process.env']).toBeTruthy()
    expect(provideApply).not.toHaveBeenCalled()
  })

  it('uses ProvidePlugin for the bundled process shim when available', async () => {
    ;(fs.existsSync as unknown as (p: any) => boolean) = vi.fn((p: any) =>
      toPosix(String(p)).endsWith('/runtime/process-shim.cjs')
    )

    const {compiler} = createCompiler('development')
    const plugin = new EnvPlugin({
      manifestPath: '/proj/manifest.json',
      browser: 'chrome'
    })
    plugin.apply(compiler as any)

    expect(provideApply).toHaveBeenCalled()
    expect(toPosix(String(lastProvideArgs.process))).toContain(
      '/runtime/process-shim.cjs'
    )
    // With a real shim provided, the broad process / process.env defines are
    // omitted so they don't shadow the polyfill.
    expect(lastDefineArgs['process']).toBeUndefined()
    expect(lastDefineArgs['process.env']).toBeUndefined()
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
    expect(getCurrentManifestContent(compilation as any)).toBe(
      updated['manifest.json']
    )
  })

  it('falls back to the nearest workspace root env file', async () => {
    ;(fs.existsSync as unknown as (p: any) => boolean) = vi.fn((p: any) => {
      const filePath = toPosix(String(p))
      return (
        filePath === '/repo/pnpm-workspace.yaml' || filePath === '/repo/.env'
      )
    })

    const {compiler, triggerCompilation} = createCompiler('development')
    compiler.options.context = '/repo/packages/extension'

    const plugin = new EnvPlugin({
      manifestPath: '/repo/packages/extension/src/manifest.json',
      browser: 'chrome'
    })
    plugin.apply(compiler as any)

    expect(lastDefineArgs['process.env.EXTENSION_PUBLIC_ROOT_ONLY']).toBe(
      JSON.stringify('rootOnly')
    )
    expect(lastDefineArgs['import.meta.env.EXTENSION_PUBLIC_ROOT_ONLY']).toBe(
      JSON.stringify('rootOnly')
    )

    const {compilation, runProcessAssets, updated} =
      createCompilationWithAssets({
        'manifest.json':
          '{"name":"$EXTENSION_PUBLIC_ROOT_ONLY","desc":"$EXTENSION_BAR"}'
      })

    triggerCompilation(compilation)
    runProcessAssets()

    expect(updated['manifest.json']).toContain('rootOnly')
    expect(updated['manifest.json']).toContain('rootBar')
  })

  it('keeps the current manifest state in sync for later manifest steps', () => {
    const {compiler, triggerCompilation} = createCompiler('development')
    const plugin = new EnvPlugin({
      manifestPath: '/proj/manifest.json',
      browser: 'chrome'
    })
    plugin.apply(compiler as any)

    const {compilation, runProcessAssets, updated} =
      createCompilationWithAssets({
        'manifest.json': '{"key":"$EXTENSION_PUBLIC_FOO"}'
      })

    triggerCompilation(compilation)
    runProcessAssets()

    expect(updated['manifest.json']).toContain('sysFoo')
    expect(getCurrentManifestContent(compilation as any)).toBe(
      updated['manifest.json']
    )
  })
})
