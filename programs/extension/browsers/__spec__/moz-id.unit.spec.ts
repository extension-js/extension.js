import {describe, expect, it} from 'vitest'
import {pickMozExtensionHost} from '../run-firefox/rdp/remote-firefox/moz-id'

// pickMozExtensionHost feeds ONLY the Firefox dev banner, and only as a fallback
// when the RDP install reply carried no id. A `moz-extension://` host is a
// per-session UUID that cannot be attributed to a specific add-on, so the picker
// must refuse to guess whenever the choice is ambiguous. These tests pin that
// "unambiguous or nothing" contract.
describe('pickMozExtensionHost', () => {
  it('returns the host when exactly one moz-extension target is present', () => {
    expect(
      pickMozExtensionHost([
        'moz-extension://11111111-1111-1111-1111-111111111111/manifest.json'
      ])
    ).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('refuses to guess when two distinct moz-extension hosts are present', () => {
    expect(
      pickMozExtensionHost([
        'moz-extension://11111111-1111-1111-1111-111111111111/manifest.json',
        'moz-extension://22222222-2222-2222-2222-222222222222/popup.html'
      ])
    ).toBeUndefined()
  })

  it('collapses repeated targets of the same host to a single candidate', () => {
    expect(
      pickMozExtensionHost([
        'moz-extension://11111111-1111-1111-1111-111111111111/manifest.json',
        'moz-extension://11111111-1111-1111-1111-111111111111/background.js'
      ])
    ).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('returns undefined when there are no moz-extension targets', () => {
    expect(
      pickMozExtensionHost(['about:blank', 'https://example.com/', undefined])
    ).toBeUndefined()
  })

  it('ignores malformed urls and returns the single valid host', () => {
    expect(
      pickMozExtensionHost([
        'moz-extension://',
        'not a url',
        undefined,
        'moz-extension://33333333-3333-3333-3333-333333333333/index.html'
      ])
    ).toBe('33333333-3333-3333-3333-333333333333')
  })
})
