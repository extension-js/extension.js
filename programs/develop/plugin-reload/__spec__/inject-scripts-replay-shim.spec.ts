import {type Compiler, sources} from '@rspack/core'
import {describe, expect, it, vi} from 'vitest'
import {InjectScriptsReplayShim} from '../steps/inject-scripts-replay-shim'

// The slice of a compilation the bridge steps read and write.
interface FakeAsset {
  name: string
  source: sources.Source
}

interface FakeCompilation {
  __assets: Record<string, FakeAsset>
  hash?: string
  [key: string]: unknown
}

function makeCompiler() {
  const processAssetsTaps: Array<{cb: () => void; opts: unknown}> = []
  let compilation: FakeCompilation = {__assets: {}}
  const compiler = {
    hooks: {
      thisCompilation: {
        tap: (_name: string, cb: (c: unknown) => void) => {
          compilation = {
            getAssets: vi.fn(() => Object.values(compilation.__assets)),
            updateAsset: vi.fn((name: string, src: sources.Source) => {
              compilation.__assets[name] = {name, source: src}
            }),
            hooks: {
              processAssets: {
                tap: (opts: unknown, fn: () => void) => {
                  processAssetsTaps.push({opts, cb: fn})
                }
              }
            },
            __assets: {}
          }

          cb(compilation)
        }
      }
    }
  } as unknown as Compiler

  return {
    compiler,
    runProcessAssets: () => {
      for (const entry of processAssetsTaps) entry.cb()
    },
    setAsset: (name: string, body: string) => {
      compilation.__assets[name] = {
        name,
        source: new sources.RawSource(body)
      }
    },
    getAssetSource: (name: string): string =>
      compilation.__assets[name]?.source.source().toString()
  }
}

describe('InjectScriptsReplayShim', () => {
  it('prepends the replay shim to the background service_worker bundle', () => {
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectScriptsReplayShim().apply(compiler)
    setAsset('background/service_worker.js', '/* user sw */ console.log(1);')
    runProcessAssets()
    const out = getAssetSource('background/service_worker.js')
    expect(out).toContain('__extjsScriptsReplayInstalled')
    expect(out).toContain('__extjsScriptsReplay')
    expect(out.indexOf('__extjsScriptsReplay')).toBeLessThan(
      out.indexOf('/* user sw */')
    )
  })

  it('prepends to MV2 background/script.js as well', () => {
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectScriptsReplayShim().apply(compiler)
    setAsset('background/script.js', '/* user background */')
    runProcessAssets()
    expect(getAssetSource('background/script.js')).toContain(
      '__extjsScriptsReplayInstalled'
    )
  })

  it('prepends to MV2 background/scripts.js, the same bundle the bridge producer targets', () => {
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectScriptsReplayShim().apply(compiler)
    setAsset('background/scripts.js', '/* mv2 background scripts */')
    runProcessAssets()
    expect(getAssetSource('background/scripts.js')).toContain(
      '__extjsScriptsReplayInstalled'
    )
  })

  it('prepends to the compiled MV2 background page bundle', () => {
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectScriptsReplayShim().apply(compiler)
    setAsset('background/index.js', '/* mv2 background page */')
    runProcessAssets()
    expect(getAssetSource('background/index.js')).toContain(
      '__extjsScriptsReplayInstalled'
    )
  })

  it('does NOT prepend to content_scripts or arbitrary assets', () => {
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectScriptsReplayShim().apply(compiler)
    setAsset('content_scripts/content-0.js', '/* content */')
    setAsset('scripts/script-one.js', '/* user script */')
    runProcessAssets()
    expect(getAssetSource('content_scripts/content-0.js')).toBe('/* content */')
    expect(getAssetSource('scripts/script-one.js')).toBe('/* user script */')
  })

  it('is idempotent, does not re-prepend if the shim is already present', () => {
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectScriptsReplayShim().apply(compiler)
    setAsset(
      'background/service_worker.js',
      '/* __extjsScriptsReplayInstalled marker */ /* user sw */'
    )

    runProcessAssets()
    const out = getAssetSource('background/service_worker.js')
    expect(out).toBe('/* __extjsScriptsReplayInstalled marker */ /* user sw */')
  })
})
