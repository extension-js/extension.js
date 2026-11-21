import type {Compiler} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {WarnBrowserGlobalWithoutPolyfill} from '../feature-browser-global'
import {PolyfillPlugin} from '../feature-polyfill'
import {CompatibilityPlugin} from '../index'

// The plugin only hands the compiler on, so an empty one stands in for it.
const emptyCompiler = () => ({}) as Compiler

describe('CompatibilityPlugin', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applies no polyfill by default and warns about browser reads instead', () => {
    const spyPolyfill = vi
      .spyOn(PolyfillPlugin.prototype, 'apply')
      .mockImplementation(() => {})
    const spyWarning = vi
      .spyOn(WarnBrowserGlobalWithoutPolyfill.prototype, 'apply')
      .mockImplementation(() => {})

    const plugin = new CompatibilityPlugin({
      manifestPath: '/abs/path/manifest.json',
      browser: undefined,
      polyfill: undefined
    })
    const compiler = emptyCompiler()

    plugin.apply(compiler)

    expect(spyPolyfill).toHaveBeenCalledTimes(0)
    expect(spyWarning.mock.calls).toEqual([[compiler]])
  })

  it('applies PolyfillPlugin when polyfill=true and browser is chromium-based', () => {
    const spyPolyfill = vi
      .spyOn(PolyfillPlugin.prototype, 'apply')
      .mockImplementation(() => {})

    const plugin = new CompatibilityPlugin({
      manifestPath: '/abs/path/manifest.json',
      browser: 'chrome',
      polyfill: true
    })
    const compiler = emptyCompiler()

    plugin.apply(compiler)

    expect(spyPolyfill.mock.calls).toEqual([[compiler]])
  })

  it('does not apply PolyfillPlugin for firefox even when polyfill=true', () => {
    const spyPolyfill = vi
      .spyOn(PolyfillPlugin.prototype, 'apply')
      .mockImplementation(() => {})

    const plugin = new CompatibilityPlugin({
      manifestPath: '/abs/path/manifest.json',
      browser: 'firefox',
      polyfill: true
    })

    plugin.apply(emptyCompiler())

    expect(spyPolyfill).toHaveBeenCalledTimes(0)
  })

  it('does not apply PolyfillPlugin for gecko-based engines even when polyfill=true', () => {
    const spyPolyfill = vi
      .spyOn(PolyfillPlugin.prototype, 'apply')
      .mockImplementation(() => {})

    const plugin = new CompatibilityPlugin({
      manifestPath: '/abs/path/manifest.json',
      browser: 'gecko-based',
      polyfill: true
    })

    plugin.apply(emptyCompiler())

    expect(spyPolyfill).toHaveBeenCalledTimes(0)
  })

  it('does not apply PolyfillPlugin for safari even when polyfill=true', () => {
    const spyPolyfill = vi
      .spyOn(PolyfillPlugin.prototype, 'apply')
      .mockImplementation(() => {})

    const plugin = new CompatibilityPlugin({
      manifestPath: '/abs/path/manifest.json',
      browser: 'safari',
      polyfill: true
    })

    plugin.apply(emptyCompiler())

    expect(spyPolyfill).toHaveBeenCalledTimes(0)
  })

  it('does not apply PolyfillPlugin for webkit-based engines even when polyfill=true', () => {
    const spyPolyfill = vi
      .spyOn(PolyfillPlugin.prototype, 'apply')
      .mockImplementation(() => {})

    const plugin = new CompatibilityPlugin({
      manifestPath: '/abs/path/manifest.json',
      browser: 'webkit-based',
      polyfill: true
    })

    plugin.apply(emptyCompiler())

    expect(spyPolyfill).toHaveBeenCalledTimes(0)
  })

  it('does not apply PolyfillPlugin for webkit-flavored fork names even when polyfill=true', () => {
    const spyPolyfill = vi
      .spyOn(PolyfillPlugin.prototype, 'apply')
      .mockImplementation(() => {})

    const plugin = new CompatibilityPlugin({
      manifestPath: '/abs/path/manifest.json',
      // Internal webkit runner forks are one family with safari/webkit-based.
      // @ts-expect-error a fork name outside BrowserType, read by its family
      browser: 'acme-webkit',
      polyfill: true
    })

    plugin.apply(emptyCompiler())

    expect(spyPolyfill).toHaveBeenCalledTimes(0)
  })
})
