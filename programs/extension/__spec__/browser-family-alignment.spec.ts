import {describe, expect, it} from 'vitest'
import {
  CHROMIUM_BASED_BROWSERS,
  CHROMIUM_FAMILY_ALIASES,
  GECKO_BASED_BROWSERS,
  GECKO_FAMILY_ALIASES,
  isChromiumBasedBrowser,
  isGeckoBasedBrowser
} from '../../develop/lib/constants'
import {
  CHROMIUM_BROWSERS,
  FIREFOX_BROWSERS,
  isChromiumBrowser,
  isFirefoxBrowser
} from '../browsers/browsers-lib/browser-family'

describe('browser-family alignment across packages', () => {
  it('launch-layer sets are derived-equal to develop lists + family aliases', () => {
    expect(new Set(CHROMIUM_BROWSERS)).toEqual(
      new Set([...CHROMIUM_BASED_BROWSERS, ...CHROMIUM_FAMILY_ALIASES])
    )
    expect(new Set(FIREFOX_BROWSERS)).toEqual(
      new Set([
        ...GECKO_BASED_BROWSERS,
        ...GECKO_FAMILY_ALIASES,
        'firefox-based'
      ])
    )
  })

  it('predicates agree on every name in the shared vocabulary', () => {
    for (const name of [
      ...CHROMIUM_BASED_BROWSERS,
      ...CHROMIUM_FAMILY_ALIASES
    ]) {
      expect(isChromiumBasedBrowser(name), name).toBe(true)
      expect(isChromiumBrowser(name), name).toBe(true)
      expect(isGeckoBasedBrowser(name), name).toBe(false)
      expect(isFirefoxBrowser(name), name).toBe(false)
    }
    for (const name of [
      ...GECKO_BASED_BROWSERS,
      ...GECKO_FAMILY_ALIASES,
      'firefox-based'
    ]) {
      expect(isGeckoBasedBrowser(name), name).toBe(true)
      expect(isFirefoxBrowser(name), name).toBe(true)
      expect(isChromiumBasedBrowser(name), name).toBe(false)
      expect(isChromiumBrowser(name), name).toBe(false)
    }
  })

  it('neither package claims safari/webkit for chromium or gecko', () => {
    for (const name of ['safari', 'webkit']) {
      expect(isChromiumBasedBrowser(name), name).toBe(false)
      expect(isChromiumBrowser(name), name).toBe(false)
      expect(isGeckoBasedBrowser(name), name).toBe(false)
      expect(isFirefoxBrowser(name), name).toBe(false)
    }
  })

  it('pins the intended semantic divergence for unknown fork names', () => {
    expect(isChromiumBasedBrowser('mychromium')).toBe(true)
    expect(isChromiumBrowser('mychromium')).toBe(false)
  })
})
