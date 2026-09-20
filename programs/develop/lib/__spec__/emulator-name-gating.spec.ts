import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  isChromiumBasedBrowser,
  isEmulatorBrowser,
  isEmulatorLaneEnabled,
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

describe('chromium-emulator behind EXTENSION_EXPERIMENTAL_EMULATOR', () => {
  it('is an unknown name while the flag is off', () => {
    expect(isEmulatorLaneEnabled({})).toBe(false)
    expect(isKnownBrowserName('chromium-emulator')).toBe(false)
    expect(normalizeBrowser('chromium-emulator')).toBe('chrome')
    expect(() => configBrowserOrThrow('chromium-emulator', 'dev')).toThrow(
      /Unsupported browser/
    )
  })

  it('is a known name that normalizes to itself with the flag on', () => {
    process.env.EXTENSION_EXPERIMENTAL_EMULATOR = '1'
    expect(isEmulatorLaneEnabled()).toBe(true)
    expect(isKnownBrowserName('chromium-emulator')).toBe(true)
    expect(normalizeBrowser('chromium-emulator')).toBe('chromium-emulator')
    expect(configBrowserOrThrow('chromium-emulator', 'dev')).toBe(
      'chromium-emulator'
    )
  })

  it('reads only 1 or true as on', () => {
    expect(isEmulatorLaneEnabled({EXTENSION_EXPERIMENTAL_EMULATOR: '0'})).toBe(
      false
    )

    expect(
      isEmulatorLaneEnabled({EXTENSION_EXPERIMENTAL_EMULATOR: 'true'})
    ).toBe(true)
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
