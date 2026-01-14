import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

// Mock rspack to intercept ProvidePlugin usage
vi.mock('@rspack/core', async () => {
  const actual: any = await vi.importActual('@rspack/core')
  const apply = vi.fn()
  const ProvidePlugin = vi.fn(() => ({apply}))
  return {
    ...actual,
    ProvidePlugin,
    default: {
      ...actual,
      ProvidePlugin
    }
  }
})

import {PolyfillPlugin} from '../feature-polyfill'
import * as rspack from '@rspack/core'

describe('PolyfillPlugin resolver/alias and provider', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('adds resolve.alias for webextension-polyfill$ and preserves existing aliases', () => {
    vi.spyOn(require as any, 'resolve').mockReturnValue(
      '/abs/browser-polyfill.js'
    )

    const compiler = {
      options: {
        resolve: {
          alias: {
            keepMe: '/x/y/z'
          }
        }
      }
    } as any

    const plugin = new PolyfillPlugin({
      manifestPath: '/abs/manifest.json',
      browser: 'chrome'
    })
    plugin.apply(compiler)

    expect(compiler.options.resolve.alias.keepMe).toBe('/x/y/z')
    expect(
      String(compiler.options.resolve.alias['webextension-polyfill$'])
    ).toContain('webextension-polyfill')
    expect(
      String(compiler.options.resolve.alias['webextension-polyfill$'])
    ).toContain('dist/browser-polyfill.js')

    const ProvidePlugin = (rspack as any).ProvidePlugin as ReturnType<
      typeof vi.fn
    >
    expect(ProvidePlugin).toHaveBeenCalledWith({
      browser: 'webextension-polyfill'
    })
    const instance = (ProvidePlugin as any).mock.results[0].value
    expect(instance.apply).toHaveBeenCalledWith(compiler)
  })

  it('initializes resolve/alias object when absent', () => {
    vi.spyOn(require as any, 'resolve').mockReturnValue(
      '/abs/browser-polyfill.js'
    )

    const compiler = {options: {}} as any

    const plugin = new PolyfillPlugin({
      manifestPath: '/abs/manifest.json',
      browser: 'edge'
    })
    plugin.apply(compiler)

    expect(compiler.options.resolve).toBeTruthy()
    expect(compiler.options.resolve!.alias).toBeTruthy()
    expect(
      String(compiler.options.resolve!.alias!['webextension-polyfill$'])
    ).toContain('webextension-polyfill')
    expect(
      String(compiler.options.resolve!.alias!['webextension-polyfill$'])
    ).toContain('dist/browser-polyfill.js')
  })
})

