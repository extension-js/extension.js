import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {PolyfillPlugin} from '../feature-polyfill'
import {CompatibilityPlugin} from '../index'

describe('CompatibilityPlugin', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not apply extra manifest compatibility writers by default', async () => {
    const spyPolyfill = vi
      .spyOn(PolyfillPlugin.prototype, 'apply')
      .mockImplementation(() => {})

    const plugin = new CompatibilityPlugin({
      manifestPath: '/abs/path/manifest.json',
      // @ts-expect-error testing default browser fallback
      browser: undefined,
      // @ts-expect-error testing default polyfill fallback
      polyfill: undefined
    })

    await plugin.apply({} as any)

    expect(spyPolyfill).toHaveBeenCalledTimes(0)
  })

  it('applies PolyfillPlugin when polyfill=true and browser is chromium-based', async () => {
    const spyPolyfill = vi
      .spyOn(PolyfillPlugin.prototype, 'apply')
      .mockImplementation(() => {})

    const plugin = new CompatibilityPlugin({
      manifestPath: '/abs/path/manifest.json',
      browser: 'chrome',
      polyfill: true
    })

    await plugin.apply({} as any)

    expect(spyPolyfill).toHaveBeenCalledTimes(1)
  })

  it('does not apply PolyfillPlugin for firefox even when polyfill=true', async () => {
    const spyPolyfill = vi
      .spyOn(PolyfillPlugin.prototype, 'apply')
      .mockImplementation(() => {})

    const plugin = new CompatibilityPlugin({
      manifestPath: '/abs/path/manifest.json',
      browser: 'firefox',
      polyfill: true
    })

    await plugin.apply({} as any)

    expect(spyPolyfill).toHaveBeenCalledTimes(0)
  })

  it('does not apply PolyfillPlugin for gecko-based engines even when polyfill=true', async () => {
    const spyPolyfill = vi
      .spyOn(PolyfillPlugin.prototype, 'apply')
      .mockImplementation(() => {})

    const plugin = new CompatibilityPlugin({
      manifestPath: '/abs/path/manifest.json',
      browser: 'gecko-based',
      polyfill: true
    })

    await plugin.apply({} as any)

    expect(spyPolyfill).toHaveBeenCalledTimes(0)
  })

  it('does not apply PolyfillPlugin for safari even when polyfill=true', async () => {
    const spyPolyfill = vi
      .spyOn(PolyfillPlugin.prototype, 'apply')
      .mockImplementation(() => {})

    const plugin = new CompatibilityPlugin({
      manifestPath: '/abs/path/manifest.json',
      browser: 'safari',
      polyfill: true
    })

    await plugin.apply({} as any)

    expect(spyPolyfill).toHaveBeenCalledTimes(0)
  })

  it('does not apply PolyfillPlugin for webkit-based engines even when polyfill=true', async () => {
    const spyPolyfill = vi
      .spyOn(PolyfillPlugin.prototype, 'apply')
      .mockImplementation(() => {})

    const plugin = new CompatibilityPlugin({
      manifestPath: '/abs/path/manifest.json',
      browser: 'webkit-based',
      polyfill: true
    })

    await plugin.apply({} as any)

    expect(spyPolyfill).toHaveBeenCalledTimes(0)
  })

  it('does not apply PolyfillPlugin for webkit-flavored fork names even when polyfill=true', async () => {
    const spyPolyfill = vi
      .spyOn(PolyfillPlugin.prototype, 'apply')
      .mockImplementation(() => {})

    const plugin = new CompatibilityPlugin({
      manifestPath: '/abs/path/manifest.json',
      // Internal webkit runner forks are one family with safari/webkit-based.
      browser: 'acme-webkit' as any,
      polyfill: true
    })

    await plugin.apply({} as any)

    expect(spyPolyfill).toHaveBeenCalledTimes(0)
  })
})
