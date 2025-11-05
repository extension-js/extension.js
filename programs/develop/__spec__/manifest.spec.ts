import {describe, it, expect} from 'vitest'
import {filterKeysForThisBrowser} from '../webpack/webpack-lib/manifest'

describe('filterKeysForThisBrowser', () => {
  it('keeps plain keys and applies chromium-prefixed overrides', () => {
    const manifest = {
      name: 'x',
      version: '1.0.0',
      'chromium:action': {default_title: 'Chromium'},
      'firefox:action': {default_title: 'Firefox'}
    } as any

    const patched = filterKeysForThisBrowser(manifest, 'chrome') as any
    expect(patched.name).toBe('x')
    expect(patched.version).toBe('1.0.0')
    expect(patched.action).toEqual({default_title: 'Chromium'})
    expect((patched as any)['firefox:action']).toBeUndefined()
  })

  it('applies gecko-prefixed overrides for firefox', () => {
    const manifest = {
      name: 'x',
      'gecko:action': {default_title: 'Gecko'},
      'chrome:action': {default_title: 'Chrome'}
    } as any

    const patched = filterKeysForThisBrowser(manifest, 'firefox') as any
    expect(patched.action).toEqual({default_title: 'Gecko'})
    expect((patched as any)['chrome:action']).toBeUndefined()
  })
})
