import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  CERTIFICATE_DESTINATION_PATH,
  CHROMIUM_BASED_BROWSERS,
  CHROMIUM_FAMILY_ALIASES,
  GECKO_BASED_BROWSERS,
  GECKO_FAMILY_ALIASES,
  isChromiumBasedBrowser,
  isGeckoBasedBrowser,
  SUPPORTED_BROWSERS
} from '../constants'

describe('constants', () => {
  it('exports certificate path under node_modules/extension-develop/dist/certs', () => {
    expect(
      CERTIFICATE_DESTINATION_PATH.endsWith(
        path.join('node_modules', 'extension-develop', 'dist', 'certs')
      )
    ).toBe(true)
  })

  it('lists chromium and gecko based browsers and union', () => {
    expect(CHROMIUM_BASED_BROWSERS).toEqual([
      'chrome',
      'edge',
      'brave',
      'opera',
      'vivaldi',
      'yandex'
    ])
    expect(GECKO_BASED_BROWSERS).toEqual(['firefox', 'waterfox', 'librewolf'])
    expect(SUPPORTED_BROWSERS).toEqual([
      'chrome',
      'edge',
      'brave',
      'opera',
      'vivaldi',
      'yandex',
      'firefox',
      'waterfox',
      'librewolf'
    ])
  })

  it('classifies every family alias with its own predicate', () => {
    // The alias arrays feed env-file resolution and the cross-package
    // alignment spec, an alias a predicate rejects is unreachable there.
    for (const name of CHROMIUM_FAMILY_ALIASES) {
      expect(isChromiumBasedBrowser(name), name).toBe(true)
      expect(isGeckoBasedBrowser(name), name).toBe(false)
    }
    for (const name of GECKO_FAMILY_ALIASES) {
      expect(isGeckoBasedBrowser(name), name).toBe(true)
      expect(isChromiumBasedBrowser(name), name).toBe(false)
    }
  })

  it('classifies fork browsers by engine family', () => {
    for (const b of [
      'chrome',
      'brave',
      'opera',
      'vivaldi',
      'yandex',
      'chromium-based'
    ]) {
      expect(isChromiumBasedBrowser(b)).toBe(true)
    }
    for (const b of ['firefox', 'waterfox', 'librewolf', 'gecko-based']) {
      expect(isGeckoBasedBrowser(b)).toBe(true)
    }
    expect(isChromiumBasedBrowser('firefox')).toBe(false)
    expect(isGeckoBasedBrowser('chrome')).toBe(false)
  })
})
