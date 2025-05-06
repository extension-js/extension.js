import {describe, it, expect} from 'vitest'
import {cleanMatches} from '../clean-matches'

describe('cleanMatches', () => {
  it('does not handle non-urls', () => {
    expect(cleanMatches(['<all_urls>'])).toEqual(['<all_urls>'])
  })

  it('handles wildcards', () => {
    expect(
      cleanMatches(['*://*/some/path', 'https://*.google.com/foo*bar'])
    ).toEqual(['*://*/*', 'https://*.google.com/*'])
  })

  it('cleans up all types of pathnames', () => {
    expect(
      cleanMatches([
        'https://example.com',
        'https://example.com/some/path/*',
        'https://example.com/some/path'
      ])
    ).toEqual([
      'https://example.com/*',
      'https://example.com/*',
      'https://example.com/*'
    ])
  })
})
