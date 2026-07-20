import {describe, expect, it} from 'vitest'
import {filterKeysForThisBrowser} from '../manifest'

describe('filterKeysForThisBrowser (manifest-lib), Safari', () => {
  const manifest = {
    name: 'x',
    'chromium:manifest_version': 3,
    'firefox:manifest_version': 2,
    'chromium:action': {default_title: 'Chromium'},
    'firefox:action': {default_title: 'Firefox'}
  } as any

  it('resolves chromium manifest_version and keys for safari', () => {
    const patched = filterKeysForThisBrowser(manifest, 'safari') as any
    expect(patched.manifest_version).toBe(3)
    expect(patched.action).toEqual({default_title: 'Chromium'})
  })

  it('resolves chromium keys for webkit-based targets', () => {
    const patched = filterKeysForThisBrowser(
      manifest,
      'webkit-based' as any
    ) as any
    expect(patched.manifest_version).toBe(3)
  })

  it('still resolves gecko keys for firefox (no chromium bleed-through)', () => {
    const patched = filterKeysForThisBrowser(manifest, 'firefox') as any
    expect(patched.manifest_version).toBe(2)
    expect(patched.action).toEqual({default_title: 'Firefox'})
  })

  describe('safari:/webkit: prefixes', () => {
    const prefixed = {
      name: 'x',
      'chromium:action': {default_title: 'Chromium'},
      'safari:action': {default_title: 'Safari'},
      permissions: ['storage'],
      'webkit:permissions': ['storage', 'nativeMessaging']
    } as any

    it('safari: wins over chromium-family keys for --browser=safari', () => {
      const patched = filterKeysForThisBrowser(prefixed, 'safari') as any
      expect(patched.action).toEqual({default_title: 'Safari'})
      expect(patched.permissions).toEqual(['storage', 'nativeMessaging'])
    })

    it('safari:/webkit: resolve identically for --browser=webkit-based', () => {
      const patched = filterKeysForThisBrowser(
        prefixed,
        'webkit-based' as any
      ) as any
      expect(patched.action).toEqual({default_title: 'Safari'})
      expect(patched.permissions).toEqual(['storage', 'nativeMessaging'])
    })

    it('safari: wins regardless of key order in the source manifest', () => {
      const reversed = {
        'safari:action': {default_title: 'Safari'},
        'chromium:action': {default_title: 'Chromium'},
        name: 'x'
      } as any
      const patched = filterKeysForThisBrowser(reversed, 'safari') as any
      expect(patched.action).toEqual({default_title: 'Safari'})
    })

    it('safari: keys are dropped for chromium and firefox targets', () => {
      const chrome = filterKeysForThisBrowser(prefixed, 'chrome') as any
      expect(chrome.action).toEqual({default_title: 'Chromium'})
      expect(chrome.permissions).toEqual(['storage'])

      const firefox = filterKeysForThisBrowser(prefixed, 'firefox') as any
      expect(firefox.action).toBeUndefined()
      expect(firefox.permissions).toEqual(['storage'])
    })
  })
})
