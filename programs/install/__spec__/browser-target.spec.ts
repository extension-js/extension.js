import {describe, expect, it} from 'vitest'
import {
  BrowserNotInstallableError,
  isBrowserNotInstallableError,
  normalizeBrowserName
} from '../lib/browser-target'

describe('browser target normalization', () => {
  it('maps engine aliases to concrete targets', () => {
    expect(normalizeBrowserName('chromium-based')).toBe('chromium')
    expect(normalizeBrowserName('gecko-based')).toBe('firefox')
    expect(normalizeBrowserName('firefox-based')).toBe('firefox')
  })

  it('accepts canonical names', () => {
    expect(normalizeBrowserName('chrome')).toBe('chrome')
    expect(normalizeBrowserName('chromium')).toBe('chromium')
    expect(normalizeBrowserName('edge')).toBe('edge')
    expect(normalizeBrowserName('firefox')).toBe('firefox')
  })

  it('throws BrowserNotInstallableError for system-located forks', () => {
    expect(() => normalizeBrowserName('brave')).toThrow(/never downloads/)
    expect(() => normalizeBrowserName('chrome,edge')).toThrow(/never downloads/)
    try {
      normalizeBrowserName('brave')
    } catch (error) {
      expect(isBrowserNotInstallableError(error)).toBe(true)
      expect(error).toBeInstanceOf(BrowserNotInstallableError)
    }
  })

  it('explains that Safari needs Xcode, not a browser install', () => {
    expect(() => normalizeBrowserName('safari')).toThrow(/ships with macOS/)
    expect(() => normalizeBrowserName('webkit-based')).toThrow(/Xcode/)
    expect(() => normalizeBrowserName('acme-webkit')).toThrow(
      /ships with macOS/
    )
    try {
      normalizeBrowserName('safari')
    } catch (error) {
      expect(isBrowserNotInstallableError(error)).toBe(true)
    }
  })
})
