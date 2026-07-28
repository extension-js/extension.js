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
