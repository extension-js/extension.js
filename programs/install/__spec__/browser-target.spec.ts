import {describe, expect, it} from 'vitest'
import {normalizeBrowserName} from '../lib/browser-target'

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

  it('throws for unsupported names', () => {
    expect(() => normalizeBrowserName('brave')).toThrow(/Unsupported browser/)
  })

  it('explains that Safari needs Xcode, not a browser install', () => {
    expect(() => normalizeBrowserName('safari')).toThrow(/ships with macOS/)
    expect(() => normalizeBrowserName('webkit-based')).toThrow(/Xcode/)
  })
})
