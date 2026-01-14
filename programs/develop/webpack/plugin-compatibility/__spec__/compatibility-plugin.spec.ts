import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {CompatibilityPlugin} from '../index'
import {PolyfillPlugin} from '../feature-polyfill'
import {BrowserSpecificFieldsPlugin} from '../feature-browser-specific-fields'

describe('CompatibilityPlugin', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applies BrowserSpecificFieldsPlugin always', async () => {
    const spyPolyfill = vi
      .spyOn(PolyfillPlugin.prototype, 'apply')
      .mockImplementation(() => {})
    const spyBrowserFields = vi
      .spyOn(BrowserSpecificFieldsPlugin.prototype, 'apply')
      .mockImplementation(() => {})

    const plugin = new CompatibilityPlugin({
      manifestPath: '/abs/path/manifest.json',
      // @ts-expect-error testing default browser fallback
      browser: undefined,
      // @ts-expect-error testing default polyfill fallback
      polyfill: undefined
    })

    await plugin.apply({} as any)

    expect(spyBrowserFields).toHaveBeenCalledTimes(1)
    expect(spyPolyfill).toHaveBeenCalledTimes(0)
  })

  it('applies PolyfillPlugin when polyfill=true and browser is chromium-based', async () => {
    const spyPolyfill = vi
      .spyOn(PolyfillPlugin.prototype, 'apply')
      .mockImplementation(() => {})
    const spyBrowserFields = vi
      .spyOn(BrowserSpecificFieldsPlugin.prototype, 'apply')
      .mockImplementation(() => {})

    const plugin = new CompatibilityPlugin({
      manifestPath: '/abs/path/manifest.json',
      browser: 'chrome',
      polyfill: true
    })

    await plugin.apply({} as any)

    expect(spyBrowserFields).toHaveBeenCalledTimes(1)
    expect(spyPolyfill).toHaveBeenCalledTimes(1)
  })

  it('does not apply PolyfillPlugin for firefox even when polyfill=true', async () => {
    const spyPolyfill = vi
      .spyOn(PolyfillPlugin.prototype, 'apply')
      .mockImplementation(() => {})
    const spyBrowserFields = vi
      .spyOn(BrowserSpecificFieldsPlugin.prototype, 'apply')
      .mockImplementation(() => {})

    const plugin = new CompatibilityPlugin({
      manifestPath: '/abs/path/manifest.json',
      browser: 'firefox',
      polyfill: true
    })

    await plugin.apply({} as any)

    expect(spyBrowserFields).toHaveBeenCalledTimes(1)
    expect(spyPolyfill).toHaveBeenCalledTimes(0)
  })
})

