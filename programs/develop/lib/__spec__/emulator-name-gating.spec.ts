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

describe('chromium-emulator, open since 2026-10-10 with an opt-out', () => {
  it('is a known name that normalizes to itself by default', () => {
    expect(isEmulatorLaneEnabled({})).toBe(true)
    expect(isKnownBrowserName('chromium-emulator')).toBe(true)
    expect(normalizeBrowser('chromium-emulator')).toBe('chromium-emulator')
    expect(configBrowserOrThrow('chromium-emulator', 'dev')).toBe(
      'chromium-emulator'
    )
  })

  it('is an unknown name again when EXTENSION_EXPERIMENTAL_EMULATOR is 0 or false', () => {
    process.env.EXTENSION_EXPERIMENTAL_EMULATOR = '0'
    expect(isEmulatorLaneEnabled()).toBe(false)
    expect(isKnownBrowserName('chromium-emulator')).toBe(false)
    expect(normalizeBrowser('chromium-emulator')).toBe('chrome')
    expect(() => configBrowserOrThrow('chromium-emulator', 'dev')).toThrow(
      /Unsupported browser/
    )
  })

  it('reads only 0 or false as the opt-out', () => {
    expect(isEmulatorLaneEnabled({EXTENSION_EXPERIMENTAL_EMULATOR: 'false'})).toBe(
      false
    )
    expect(isEmulatorLaneEnabled({EXTENSION_EXPERIMENTAL_EMULATOR: '1'})).toBe(
      true
    )
    expect(isEmulatorLaneEnabled({EXTENSION_EXPERIMENTAL_EMULATOR: ''})).toBe(
      true
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
