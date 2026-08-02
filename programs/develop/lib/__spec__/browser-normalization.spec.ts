import {describe, expect, it} from 'vitest'
import {devtoolsEngineFor, normalizeBrowser} from '../paths'

describe('devtoolsEngineFor', () => {
  it('maps chromium forks and aliases to their engine build', () => {
    expect(devtoolsEngineFor('chrome')).toBe('chrome')
    expect(devtoolsEngineFor('edge')).toBe('edge')
    for (const b of [
      'chromium',
      'chromium-based',
      'brave',
      'opera',
      'vivaldi',
      'yandex'
    ]) {
      expect(devtoolsEngineFor(b), b).toBe('chromium')
    }
    for (const b of ['firefox', 'gecko-based', 'waterfox', 'librewolf']) {
      expect(devtoolsEngineFor(b), b).toBe('firefox')
    }
  })

  // Safari is not a chromium fork: it must never be handed a chrome-engine
  // companion build, so the mapping says safari and callers find no dist.
  it('maps safari and webkit-based to safari, never chrome', () => {
    expect(devtoolsEngineFor('safari')).toBe('safari')
    expect(devtoolsEngineFor('webkit-based')).toBe('safari')
  })

  it('falls back to chrome for unknown input', () => {
    expect(devtoolsEngineFor(undefined)).toBe('chrome')
    expect(devtoolsEngineFor('netscape')).toBe('chrome')
  })
})

describe('normalizeBrowser safariBinary wiring', () => {
  it('defaults to webkit-based when only a safari binary is given', () => {
    expect(
      normalizeBrowser(undefined, undefined, undefined, '/Applications/S.app')
    ).toBe('webkit-based')
  })

  it('keeps an explicit safari request with a safari binary', () => {
    expect(
      normalizeBrowser('safari', undefined, undefined, '/Applications/S.app')
    ).toBe('safari')
  })

  it('does not hijack an explicit non-webkit browser', () => {
    expect(
      normalizeBrowser('chrome', undefined, undefined, '/Applications/S.app')
    ).toBe('chrome')
    expect(
      normalizeBrowser('firefox', undefined, undefined, '/Applications/S.app')
    ).toBe('firefox')
  })

  it('lets a chromium binary win when both binaries are present', () => {
    expect(
      normalizeBrowser(undefined, '/bin/chromium', undefined, '/bin/safari')
    ).toBe('chromium-based')
  })

  it('still defaults to chrome without any binary', () => {
    expect(normalizeBrowser(undefined)).toBe('chrome')
  })
})
