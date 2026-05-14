// Regression: InjectScriptsReplayShim prepends the dev-only
// `globalThis.__extjsScriptsReplay` shim to the compiled background SW /
// script bundle so the controller can replay programmatic
// `chrome.scripting.executeScript` calls after a user edits a file in
// `/scripts/*`.

import {describe, it, expect, vi} from 'vitest'
import {sources, Compilation} from '@rspack/core'
import {InjectScriptsReplayShim} from '../steps/setup-reload-strategy/inject-scripts-replay-shim'

function makeCompiler() {
  const processAssetsTaps: Array<{cb: () => void; opts: any}> = []
  let compilation: any
  const compiler: any = {
    hooks: {
      thisCompilation: {
        tap: (_name: string, cb: (c: any) => void) => {
          compilation = {
            getAssets: vi.fn(() => Object.values(compilation.__assets)),
            updateAsset: vi.fn((name: string, src: any) => {
              compilation.__assets[name] = {name, source: src}
            }),
            hooks: {
              processAssets: {
                tap: (opts: any, fn: () => void) => {
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
  }
  return {
    compiler,
    runProcessAssets: () => processAssetsTaps.forEach((entry) => entry.cb()),
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
    // User code must still be present, preceded by the shim.
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

  it('is idempotent — does not re-prepend if the shim is already present', () => {
    const {compiler, runProcessAssets, setAsset, getAssetSource} =
      makeCompiler()
    new InjectScriptsReplayShim().apply(compiler)
    setAsset(
      'background/service_worker.js',
      '/* __extjsScriptsReplayInstalled marker */ /* user sw */'
    )
    runProcessAssets()
    const out = getAssetSource('background/service_worker.js')
    // Should equal the input — no double-prepend.
    expect(out).toBe(
      '/* __extjsScriptsReplayInstalled marker */ /* user sw */'
    )
  })
})
