import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  isChromiumBasedBrowser,
  isEmulatorBrowser,
  isGeckoBasedBrowser
} from '../constants'
import {filterKeysForThisBrowser} from '../manifest-utils'
import {
  asAbsolute,
  configBrowserOrThrow,
  devtoolsEngineFor,
  getDistPath,
  isKnownBrowserName,
  normalizeBrowser
} from '../paths'

afterEach(() => {
  delete process.env.EXTENSION_EXPERIMENTAL_EMULATOR
})

describe('chromium-emulator as a browser name', () => {
  it('is a known name that normalizes to itself with no env flag', () => {
    delete process.env.EXTENSION_EXPERIMENTAL_EMULATOR
    expect(isKnownBrowserName('chromium-emulator')).toBe(true)
    expect(normalizeBrowser('chromium-emulator')).toBe('chromium-emulator')
    expect(configBrowserOrThrow('chromium-emulator', 'dev')).toBe(
      'chromium-emulator'
    )
  })

  it('reads the same with the retired EXTENSION_EXPERIMENTAL_EMULATOR set either way', () => {
    for (const value of ['0', '1', 'true', 'false']) {
      process.env.EXTENSION_EXPERIMENTAL_EMULATOR = value
      expect(normalizeBrowser('chromium-emulator'), value).toBe(
        'chromium-emulator'
      )

      expect(isKnownBrowserName('chromium-emulator'), value).toBe(true)
    }
  })

  it('still refuses a name nobody spells', () => {
    expect(isKnownBrowserName('chromium-emulatr')).toBe(false)
    expect(() => configBrowserOrThrow('chromium-emulatr', 'dev')).toThrow(
      /Unsupported browser/
    )
  })

  it('is chromium family for manifests and output, in dist/chromium-emulator', () => {
    expect(isEmulatorBrowser('chromium-emulator')).toBe(true)
    expect(isChromiumBasedBrowser('chromium-emulator')).toBe(true)
    expect(isGeckoBasedBrowser('chromium-emulator')).toBe(false)
    expect(devtoolsEngineFor('chromium-emulator')).toBe('chromium')
    // Resolve the root once: on Windows a bare '/proj' carries no drive letter
    // while path.resolve() adds one, and the two never compare equal.
    const root = asAbsolute(path.resolve('/proj'))
    expect(getDistPath(root, 'chromium-emulator')).toBe(
      path.join(root, 'dist', 'chromium-emulator')
    )

    const filtered = filterKeysForThisBrowser(
      {
        name: 'x',
        'chromium:minimum_chrome_version': '120',
        'firefox:browser_specific_settings': {gecko: {id: 'x@y'}}
      } as any,
      'chromium-emulator'
    ) as Record<string, unknown>
    expect(filtered.minimum_chrome_version).toBe('120')
    expect(filtered).not.toHaveProperty('browser_specific_settings')
  })
})
