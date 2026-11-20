import {describe, expect, it} from 'vitest'
import {envFileCandidates} from '../config-loader'
import {
  CHROMIUM_FAMILY_ALIASES,
  GECKO_FAMILY_ALIASES,
  SUPPORTED_BROWSERS
} from '../constants'

const MODES = ['development', 'production', 'none']

// `.env.<browser>` and `.env.<mode>` share one name shape, so a browser named
// like a mode, or either named like a fixed suffix, would read the other's file.
describe('the env file names of a run', () => {
  const browsers = [
    ...SUPPORTED_BROWSERS,
    ...CHROMIUM_FAMILY_ALIASES,
    ...GECKO_FAMILY_ALIASES,
    'safari',
    'webkit-based'
  ]

  it('has no browser named like a mode or a fixed suffix', () => {
    const taken = [...MODES, 'local', 'defaults', 'example']

    expect(browsers.filter((browser) => taken.includes(browser))).toEqual([])
  })

  it.each(MODES)('names each file once under mode %s', (mode) => {
    for (const browser of browsers) {
      const files = envFileCandidates(mode, browser)

      expect(new Set(files).size).toBe(files.length)
    }
  })
})
