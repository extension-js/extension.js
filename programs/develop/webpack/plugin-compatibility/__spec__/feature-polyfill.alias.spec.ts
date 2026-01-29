import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

const toPosix = (value: string) => value.replace(/\\/g, '/')

const provideApply = vi.fn()

// Mock rspack to intercept ProvidePlugin usage
vi.mock('@rspack/core', async () => {
  const actual: any = await vi.importActual('@rspack/core')
  class ProvidePluginMock {
    public static lastOptions: any
    constructor(options: any) {
      ;(ProvidePluginMock as any).lastOptions = options
    }
    apply = provideApply
  }
  return {
    ...actual,
    ProvidePlugin: ProvidePluginMock,
    default: {
      ...actual,
      ProvidePlugin: ProvidePluginMock
    }
  }
})

import {PolyfillPlugin} from '../feature-polyfill'
import * as rspack from '@rspack/core'

describe('PolyfillPlugin resolver/alias and provider', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    provideApply.mockClear()
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
        context: '/project',
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
      toPosix(String(compiler.options.resolve.alias['webextension-polyfill$']))
    ).toContain('webextension-polyfill')
    expect(
      toPosix(String(compiler.options.resolve.alias['webextension-polyfill$']))
    ).toContain('dist/browser-polyfill.js')

    const ProvidePlugin = (rspack as any).ProvidePlugin as any
    expect(ProvidePlugin.lastOptions).toEqual({
      browser: 'webextension-polyfill'
    })
    expect(provideApply).toHaveBeenCalledWith(compiler)
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
      toPosix(
        String(compiler.options.resolve!.alias!['webextension-polyfill$'])
      )
    ).toContain('webextension-polyfill')
    expect(
      toPosix(
        String(compiler.options.resolve!.alias!['webextension-polyfill$'])
      )
    ).toContain('dist/browser-polyfill.js')
  })
})
