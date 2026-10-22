import {describe, expect, it} from 'vitest'
import {cleanMatches} from '../web-resources-lib/clean-matches'

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

  it('drops a query or fragment after the path', () => {
    expect(
      cleanMatches([
        '*://*.example.com/*?q=*',
        'https://example.com/search?x=1',
        'https://example.com?x=1',
        'https://example.com/page#top'
      ])
    ).toEqual([
      '*://*.example.com/*',
      'https://example.com/*',
      'https://example.com/*',
      'https://example.com/*'
    ])
  })

  it('keeps ports and file urls as origins', () => {
    expect(
      cleanMatches(['http://localhost:8080/app/*', 'file:///home/user/*'])
    ).toEqual(['http://localhost:8080/*', 'file:///*'])
  })
})
