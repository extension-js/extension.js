import {describe, it, expect, vi, afterEach} from 'vitest'
import {BrowserSpecificFieldsPlugin} from '../feature-browser-specific-fields'

// Avoid filesystem access by mocking fs read for manifest helper
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => '{}')
}))

describe('BrowserSpecificFieldsPlugin.apply integration', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('updates manifest.json asset with patched content at processAssets', () => {
    const plugin = new BrowserSpecificFieldsPlugin({
      manifestPath: '/abs/manifest.json',
      browser: 'chrome'
    })

    const patched = JSON.stringify({patched: true})
    vi.spyOn(plugin as any, 'patchManifest').mockReturnValue(patched)

    const updateAsset = vi.fn()
    const compilation = {
      hooks: {
        processAssets: {
          tap: (_opts: any, fn: Function) => fn()
        }
      },
      updateAsset
    } as any

    const compiler = {
      hooks: {
        compilation: {
          tap: (_name: string, cb: Function) => cb(compilation)
        }
      }
    } as any

    plugin.apply(compiler)

    expect(updateAsset).toHaveBeenCalledTimes(1)
    const [assetName, assetSource] = updateAsset.mock.calls[0]
    expect(assetName).toBe('manifest.json')
    expect(typeof assetSource.source).toBe('function')
    expect(assetSource.source().toString()).toBe(patched)
  })
})
