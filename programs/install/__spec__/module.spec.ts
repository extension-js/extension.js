import {describe, expect, it} from 'vitest'
import path from 'node:path'
import {getManagedBrowsersCacheRoot} from '../module'

describe('install module exports', () => {
  it('resolves cache root from EXT_BROWSERS_CACHE_DIR override', () => {
    const prev = process.env.EXT_BROWSERS_CACHE_DIR
    process.env.EXT_BROWSERS_CACHE_DIR = '/tmp/extjs-custom-cache'
    try {
      expect(getManagedBrowsersCacheRoot()).toBe(
        path.resolve('/tmp/extjs-custom-cache')
      )
    } finally {
      if (typeof prev === 'undefined') {
        delete process.env.EXT_BROWSERS_CACHE_DIR
      } else {
        process.env.EXT_BROWSERS_CACHE_DIR = prev
      }
    }
  })
})
