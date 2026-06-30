import {describe, it, expect} from 'vitest'
import {filterKeysForThisBrowser} from '../../../lib/manifest-utils'

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

  it('resolves chromium-prefixed keys for safari (MV3 chromium-shaped bundle)', () => {
    // Regression: Safari ships an MV3, chromium-shaped extension produced by the
    // converter, so chromium:/chrome: prefixed keys (including manifest_version)
    // must resolve. Otherwise the emitted Safari manifest has no manifest_version
    // and is invalid.
    const manifest = {
      name: 'x',
      'chromium:manifest_version': 3,
      'firefox:manifest_version': 2,
      'chromium:action': {default_title: 'Chromium'},
      'firefox:action': {default_title: 'Firefox'}
    } as any

    const patched = filterKeysForThisBrowser(manifest, 'safari') as any
    expect(patched.manifest_version).toBe(3)
    expect(patched.action).toEqual({default_title: 'Chromium'})
    expect((patched as any)['firefox:action']).toBeUndefined()
  })
})
