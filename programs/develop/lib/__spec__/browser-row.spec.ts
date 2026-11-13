import {describe, expect, it} from 'vitest'
import {browserRowValue} from '../messaging'

describe('card browser row', () => {
  it('title-cases a bare browser name', () => {
    expect(browserRowValue('chromium')).toBe('Chromium')
    expect(browserRowValue('edge')).toBe('Edge')
    expect(browserRowValue('firefox-based')).toBe('Firefox-based')
  })

  it('falls back to unknown when the caller has no browser', () => {
    expect(browserRowValue('')).toBe('Unknown')
  })

  it('keeps a version line that already names the browser', () => {
    expect(browserRowValue('chromium', 'Chromium 146.0.7670.0')).toBe(
      'Chromium 146.0.7670.0'
    )
  })

  it('prefixes the browser name onto a bare version number', () => {
    expect(browserRowValue('chromium', '146.0.7670.0')).toBe(
      'Chromium 146.0.7670.0'
    )
  })

  it('title-cases a lowercase version line', () => {
    expect(browserRowValue('chromium', 'chromium 146.0.7670.0')).toBe(
      'Chromium 146.0.7670.0'
    )
  })

  it('names the Nightly channel for a Firefox alpha version and no other', () => {
    expect(browserRowValue('firefox', '160.0a1')).toBe(
      'Firefox Nightly 160.0a1'
    )

    expect(browserRowValue('firefox', 'Mozilla Firefox 160.0a1')).toBe(
      'Mozilla Firefox Nightly 160.0a1'
    )

    expect(browserRowValue('firefox', 'Firefox Nightly 160.0a1')).toBe(
      'Firefox Nightly 160.0a1'
    )

    expect(browserRowValue('firefox', '145.0')).toBe('Firefox 145.0')
    expect(browserRowValue('firefox', '128.5.0esr')).toBe('Firefox 128.5.0esr')
    expect(browserRowValue('zen', '1.22.3a1')).toBe('Zen 1.22.3a1')
  })

  it('keeps mode suffixes intact', () => {
    expect(browserRowValue('chromium', 'Chromium (no-browser mode)')).toBe(
      'Chromium (no-browser mode)'
    )
  })

  it('renders one spelling for dev, start, preview and build', () => {
    const dev = browserRowValue('chromium', 'Chromium 146.0.7670.0')
    const start = browserRowValue('chromium', 'Chromium 146.0.7670.0')
    const preview = browserRowValue('chromium', 'Chromium 146.0.7670.0')
    const build = browserRowValue('chromium')

    expect(new Set([dev, start, preview]).size).toBe(1)
    expect(preview).not.toBe('chromium')
    expect(build).toBe('Chromium')

    for (const value of [dev, start, preview, build]) {
      expect(value.startsWith('Chromium')).toBe(true)
    }
  })
})
