import type {Configuration} from '@rspack/core'
import {afterEach, describe, expect, it, vi} from 'vitest'
import * as messages from '../messages'
import {
  applySplitChunksGuard,
  normalizeSplitChunks
} from '../normalize-split-chunks'
import {
  defaultSplitChunks,
  isPageChunkName,
  pageInitialChunks
} from '../split-chunks'

type Selector = (chunk: {
  name?: string
  canBeInitial?: () => boolean
}) => boolean

function selectorAt(config: Configuration, path: string[]): Selector {
  let node: any = config.optimization?.splitChunks
  for (const key of path) node = node?.[key]
  expect(typeof node).toBe('function')
  return node as Selector
}

const chunk = (name: string | undefined, initial = true) => ({
  name,
  canBeInitial: () => initial
})

describe('isPageChunkName', () => {
  it('treats every entry but background, content and scripts as a page', () => {
    for (const name of [
      'action/index',
      'options/index',
      'newtab/index',
      'sidebar/index',
      'devtools/index',
      'pages/main',
      'sandbox/page-0'
    ]) {
      expect(isPageChunkName(name)).toBe(true)
    }
    for (const name of [
      'background/service_worker',
      'background/scripts',
      'background/index',
      'content_scripts/content-0',
      'scripts/inject'
    ]) {
      expect(isPageChunkName(name)).toBe(false)
    }
    expect(isPageChunkName(undefined)).toBe(false)
    expect(isPageChunkName('')).toBe(false)
  })
})

describe('defaultSplitChunks', () => {
  it('selects only the initial chunk of a page', () => {
    expect(pageInitialChunks(chunk('action/index'))).toBe(true)
    expect(pageInitialChunks(chunk('action/index', false))).toBe(false)
    expect(pageInitialChunks(chunk('background/service_worker'))).toBe(false)
    expect(pageInitialChunks(chunk('content_scripts/content-0'))).toBe(false)
    expect(pageInitialChunks(chunk('scripts/inject'))).toBe(false)
    expect(pageInitialChunks(chunk(undefined))).toBe(false)
  })

  it('names two stable sibling files and turns the stock groups off', () => {
    const config = defaultSplitChunks() as any
    expect(config.chunks).toBe(pageInitialChunks)
    expect(config.cacheGroups.default).toBe(false)
    expect(config.cacheGroups.defaultVendors).toBe(false)
    expect(config.cacheGroups.framework.filename).toBe('shared/framework.js')
    expect(config.cacheGroups.commons.filename).toBe('shared/commons.js')
    expect(config.cacheGroups.commons.minChunks).toBe(2)
    for (const file of [
      '/p/node_modules/react/index.js',
      '/p/node_modules/react-dom/client.js',
      '/p/node_modules/.pnpm/react@18.3.1/node_modules/react/index.js',
      '/p/node_modules/preact/compat/dist/compat.js',
      '/p/node_modules/@vue/runtime-dom/index.js',
      '/p/node_modules/svelte/src/runtime/index.js',
      '/p/node_modules/solid-js/dist/solid.js',
      '/p/node_modules/lit/index.js',
      'C:\\p\\node_modules\\vue\\dist\\vue.js'
    ]) {
      expect(config.cacheGroups.framework.test.test(file)).toBe(true)
    }
    for (const file of [
      '/p/node_modules/react-refresh/runtime.js',
      '/p/node_modules/lodash/index.js',
      '/p/src/react/index.js'
    ]) {
      expect(config.cacheGroups.framework.test.test(file)).toBe(false)
    }
  })
})

describe('normalizeSplitChunks', () => {
  it("rewrites chunks: 'all' into a selector that skips the single-file surfaces", () => {
    const {config, narrowed} = normalizeSplitChunks({
      optimization: {splitChunks: {chunks: 'all'}}
    })
    expect(narrowed).toEqual(['splitChunks.chunks'])
    const selector = selectorAt(config, ['chunks'])
    expect(selector(chunk('action/index'))).toBe(true)
    expect(selector(chunk('action/index', false))).toBe(true)
    expect(selector(chunk(undefined, false))).toBe(true)
    expect(selector(chunk('background/service_worker'))).toBe(false)
    expect(selector(chunk('content_scripts/content-0'))).toBe(false)
    expect(selector(chunk('scripts/inject'))).toBe(false)
  })

  it("rewrites chunks: 'initial' and keeps async chunks out of it", () => {
    const {config, narrowed} = normalizeSplitChunks({
      optimization: {splitChunks: {chunks: 'initial'}}
    })
    expect(narrowed).toEqual(['splitChunks.chunks'])
    const selector = selectorAt(config, ['chunks'])
    expect(selector(chunk('action/index'))).toBe(true)
    expect(selector(chunk('action/index', false))).toBe(false)
    expect(selector(chunk(undefined, false))).toBe(false)
    expect(selector(chunk('background/service_worker'))).toBe(false)
  })

  it("leaves chunks: 'async', a RegExp and a user function alone", () => {
    const fn = () => true
    const input: Configuration = {
      optimization: {
        splitChunks: {
          chunks: 'async',
          cacheGroups: {
            a: {chunks: fn},
            b: {chunks: /^pages\//},
            c: {chunks: 'async'}
          }
        }
      }
    }
    const {config, narrowed} = normalizeSplitChunks(input)
    expect(narrowed).toEqual([])
    expect(config).toBe(input)
  })

  it('preserves a user splitChunks: false and a missing optimization', () => {
    const off: Configuration = {optimization: {splitChunks: false}}
    expect(normalizeSplitChunks(off).config).toBe(off)
    expect(normalizeSplitChunks(off).config.optimization?.splitChunks).toBe(
      false
    )
    const bare: Configuration = {}
    expect(normalizeSplitChunks(bare).config).toBe(bare)
  })

  it('walks every cache group and reports each rewritten path', () => {
    const input: Configuration = {
      mode: 'production',
      optimization: {
        minimize: true,
        splitChunks: {
          chunks: 'async',
          minSize: 0,
          cacheGroups: {
            vendors: {test: /node_modules/, chunks: 'all', name: 'vendors'},
            shared: {chunks: 'initial', name: 'shared'},
            off: false,
            untouched: {chunks: 'async'}
          }
        }
      }
    }
    const {config, narrowed} = normalizeSplitChunks(input)
    expect(narrowed).toEqual([
      'splitChunks.cacheGroups.vendors.chunks',
      'splitChunks.cacheGroups.shared.chunks'
    ])
    const split = config.optimization?.splitChunks as any
    expect(split.chunks).toBe('async')
    expect(split.minSize).toBe(0)
    expect(split.cacheGroups.vendors.name).toBe('vendors')
    expect(split.cacheGroups.vendors.test).toEqual(/node_modules/)
    expect(split.cacheGroups.off).toBe(false)
    expect(split.cacheGroups.untouched.chunks).toBe('async')
    const vendors = selectorAt(config, ['cacheGroups', 'vendors', 'chunks'])
    expect(vendors(chunk('options/index'))).toBe(true)
    expect(vendors(chunk('content_scripts/content-1'))).toBe(false)
    const shared = selectorAt(config, ['cacheGroups', 'shared', 'chunks'])
    expect(shared(chunk('options/index'))).toBe(true)
    expect(shared(chunk('options/index', false))).toBe(false)
    expect(shared(chunk('background/scripts'))).toBe(false)

    // The input is never mutated and the untouched branches are shared.
    expect(
      (input.optimization?.splitChunks as any).cacheGroups.vendors.chunks
    ).toBe('all')
    expect(config.mode).toBe('production')
    expect(config.optimization?.minimize).toBe(true)
  })
})

describe('applySplitChunksGuard', () => {
  const originalDebug = process.env.EXTENSION_DEBUG
  const originalAuthor = process.env.EXTENSION_AUTHOR_MODE

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalDebug === undefined) delete process.env.EXTENSION_DEBUG
    else process.env.EXTENSION_DEBUG = originalDebug
    if (originalAuthor === undefined) delete process.env.EXTENSION_AUTHOR_MODE
    else process.env.EXTENSION_AUTHOR_MODE = originalAuthor
  })

  it('prints one debug line naming what it narrowed under EXTENSION_DEBUG', () => {
    process.env.EXTENSION_DEBUG = '1'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    applySplitChunksGuard({
      optimization: {
        splitChunks: {chunks: 'all', cacheGroups: {shared: {chunks: 'initial'}}}
      }
    })
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(
      messages.debugSplitChunksNarrowed([
        'splitChunks.chunks',
        'splitChunks.cacheGroups.shared.chunks'
      ])
    )
    expect(String(log.mock.calls[0][0])).toContain(
      'single-file=background,content_scripts/,scripts/'
    )
  })

  it('stays silent when nothing was narrowed or debug is off', () => {
    process.env.EXTENSION_DEBUG = '1'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    applySplitChunksGuard({optimization: {splitChunks: {chunks: 'async'}}})
    expect(log).not.toHaveBeenCalled()

    process.env.EXTENSION_DEBUG = '0'
    delete process.env.EXTENSION_AUTHOR_MODE
    applySplitChunksGuard({optimization: {splitChunks: {chunks: 'all'}}})
    expect(log).not.toHaveBeenCalled()
  })
})
