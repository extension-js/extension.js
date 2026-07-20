import {describe, expect, it} from 'vitest'
import {filterKeysForThisBrowser} from '../../../../lib/manifest-utils'

const MANIFEST = {
  name: 'x',
  'chromium:manifest_version': 3,
  'firefox:manifest_version': 2,
  'chromium:action': {default_title: 'Chromium'},
  'firefox:action': {default_title: 'Firefox'}
} as any

const CHROMIUM_TARGETS = [
  'chrome',
  'chromium',
  'edge',
  'brave',
  'opera',
  'vivaldi',
  'yandex',
  'chromium-based',
  'safari',
  'webkit-based'
]

const GECKO_TARGETS = [
  'firefox',
  'waterfox',
  'librewolf',
  'gecko-based',
  'firefox-based'
]

describe('browser engine-family manifest fallback', () => {
  for (const browser of CHROMIUM_TARGETS) {
    it(`${browser} falls back to the chromium family`, () => {
      const patched = filterKeysForThisBrowser(MANIFEST, browser as any) as any
      expect(patched.manifest_version).toBe(3)
      expect(patched.action).toEqual({default_title: 'Chromium'})
    })
  }

  for (const browser of GECKO_TARGETS) {
    it(`${browser} falls back to the gecko family`, () => {
      const patched = filterKeysForThisBrowser(MANIFEST, browser as any) as any
      expect(patched.manifest_version).toBe(2)
      expect(patched.action).toEqual({default_title: 'Firefox'})
    })
  }
})
