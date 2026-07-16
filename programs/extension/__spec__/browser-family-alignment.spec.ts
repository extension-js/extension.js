import {describe, it, expect} from 'vitest'
import {
  CHROMIUM_BASED_BROWSERS,
  GECKO_BASED_BROWSERS,
  CHROMIUM_FAMILY_ALIASES,
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

// Two family classifiers exist ON PURPOSE: extension-develop's is
// substring-permissive (manifest prefixes and env files should treat any
// *chromium* name as chromium-family), the launch layer's is exact-set
// (binary selection must not guess for unknown names). What must NOT differ
// is the shared vocabulary — a browser name one package classifies and the
// other doesn't is exactly how `--browser chromium` got refused in the
// field. This spec derives both vocabularies from develop's exported lists,
// so extending one package without the other fails here, in review.
describe('browser-family alignment across packages', () => {
  it('launch-layer sets are derived-equal to develop lists + family aliases', () => {
    expect(new Set(CHROMIUM_BROWSERS)).toEqual(
      new Set([...CHROMIUM_BASED_BROWSERS, ...CHROMIUM_FAMILY_ALIASES])
    )
    expect(new Set(FIREFOX_BROWSERS)).toEqual(
      new Set([...GECKO_BASED_BROWSERS, ...GECKO_FAMILY_ALIASES, 'firefox-based'])
    )
  })

  it('predicates agree on every name in the shared vocabulary', () => {
    for (const name of [...CHROMIUM_BASED_BROWSERS, ...CHROMIUM_FAMILY_ALIASES]) {
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
    // develop is substring-permissive so an unknown *chromium* fork still
    // resolves chromium-family manifest keys; the launch layer stays
    // exact-set so binary selection never guesses. Deliberate, not drift.
    expect(isChromiumBasedBrowser('mychromium')).toBe(true)
    expect(isChromiumBrowser('mychromium')).toBe(false)
  })
})
