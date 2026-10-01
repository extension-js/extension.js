import type {Configuration} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {
  applySplitChunksGuard,
  keepUserEntriesWhole,
  userEntryNames
} from '../normalize-split-chunks'
import {defaultSplitChunks} from '../split-chunks'

type Selector = (chunk: {
  name?: string
  canBeInitial?: () => boolean
}) => boolean

const chunk = (name: string | undefined, initial = true) => ({
  name,
  canBeInitial: () => initial
})

function selector(config: Configuration): Selector {
  const chunks = (config.optimization?.splitChunks as {chunks?: unknown})
    ?.chunks
  expect(typeof chunks).toBe('function')

  return chunks as Selector
}

describe('userEntryNames', () => {
  it('reads the names of an object entry map and nothing else', () => {
    expect(
      userEntryNames({
        entry: {'changelog/changelog': './c.js', 'a/b': './b.js'}
      })
    ).toEqual(['changelog/changelog', 'a/b'])

    expect(userEntryNames({entry: './single.js'} as Configuration)).toEqual([])
    expect(userEntryNames({})).toEqual([])
  })
})

describe('keepUserEntriesWhole', () => {
  it('keeps a user entry out of the page chunk split', () => {
    const config: Configuration = {
      entry: {'changelog/changelog': './changelog.js'},
      optimization: {splitChunks: defaultSplitChunks()}
    }
    const pick = selector(keepUserEntriesWhole(config))

    expect(pick(chunk('changelog/changelog'))).toBe(false)
    expect(pick(chunk('action/index'))).toBe(true)
    expect(pick(chunk('background/service_worker'))).toBe(false)
  })

  it('leaves the config alone without user entries or a function selector', () => {
    const noEntries: Configuration = {
      entry: {},
      optimization: {splitChunks: defaultSplitChunks()}
    }
    expect(keepUserEntriesWhole(noEntries)).toBe(noEntries)

    const asyncOnly: Configuration = {
      entry: {'x/y': './y.js'},
      optimization: {splitChunks: {chunks: 'async'}}
    }
    expect(keepUserEntriesWhole(asyncOnly)).toBe(asyncOnly)

    const off: Configuration = {
      entry: {'x/y': './y.js'},
      optimization: {splitChunks: false}
    }
    expect(keepUserEntriesWhole(off)).toBe(off)
  })

  it('keeps a user entry out of a cache group with its own selector', () => {
    const config: Configuration = {
      entry: {'changelog/changelog': './changelog.js'},
      optimization: {
        splitChunks: {
          chunks: 'async',
          cacheGroups: {
            vendor: {test: /shared\.js$/, chunks: () => true, enforce: true},
            all: {test: /shared\.js$/, chunks: 'all', enforce: true},
            off: false
          }
        }
      }
    }
    const next = applySplitChunksGuard(config)
    const split = next.optimization?.splitChunks as any
    expect(split.chunks).toBe('async')
    expect(split.cacheGroups.off).toBe(false)
    expect(split.cacheGroups.vendor.enforce).toBe(true)

    for (const group of ['vendor', 'all']) {
      const pick = split.cacheGroups[group].chunks as Selector
      expect(pick(chunk('changelog/changelog'))).toBe(false)
      expect(pick(chunk('action/index'))).toBe(true)
    }
  })

  it('runs inside the guard every compiler goes through', () => {
    const config: Configuration = {
      entry: {'pages/extra': './extra.js'},
      optimization: {splitChunks: defaultSplitChunks()}
    }
    const pick = selector(applySplitChunksGuard(config))

    expect(pick(chunk('pages/extra'))).toBe(false)
    expect(pick(chunk('options/index'))).toBe(true)
  })
})
