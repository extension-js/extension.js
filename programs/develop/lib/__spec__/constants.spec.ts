import {describe, it, expect} from 'vitest'
import * as path from 'path'
import {
  CERTIFICATE_DESTINATION_PATH,
  CHROMIUM_BASED_BROWSERS,
  GECKO_BASED_BROWSERS,
  SUPPORTED_BROWSERS,
  isChromiumBasedBrowser,
  isGeckoBasedBrowser
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

  it('classifies fork browsers by engine family', () => {
    for (const b of ['chrome', 'brave', 'opera', 'vivaldi', 'yandex', 'chromium-based']) {
      expect(isChromiumBasedBrowser(b)).toBe(true)
    }
    for (const b of ['firefox', 'waterfox', 'librewolf', 'gecko-based']) {
      expect(isGeckoBasedBrowser(b)).toBe(true)
    }
    expect(isChromiumBasedBrowser('firefox')).toBe(false)
    expect(isGeckoBasedBrowser('chrome')).toBe(false)
  })
})
