import {describe, expect, it} from 'vitest'
import {
  declaredHostPatterns,
  devInjectedHostPatterns,
  findAbsoluteRequestUrls,
  isContentScriptModule,
  matchesHostPattern,
  optionalHostPatterns
} from '../apply-dev-defaults-lib/dev-injected-hosts'

describe('devInjectedHostPatterns', () => {
  it('unions every content-script match and nothing else', () => {
    expect(
      devInjectedHostPatterns({
        manifest_version: 3,
        host_permissions: ['https://declared.test/*'],
        content_scripts: [
          {matches: ['https://a.test/*', 'https://b.test/*']},
          {matches: ['https://c.test/*']}
        ]
      })
    ).toEqual(['https://a.test/*', 'https://b.test/*', 'https://c.test/*'])
  })

  it('returns nothing when there are no content scripts', () => {
    expect(devInjectedHostPatterns({manifest_version: 3})).toEqual([])
    expect(devInjectedHostPatterns({content_scripts: 'nope'})).toEqual([])
  })
})

describe('declaredHostPatterns', () => {
  it('reads host_permissions on MV3', () => {
    expect(
      declaredHostPatterns({
        manifest_version: 3,
        host_permissions: ['https://a.test/*'],
        permissions: ['tabs']
      })
    ).toEqual(['https://a.test/*'])
  })

  it('separates hosts from API permissions on MV2', () => {
    expect(
      declaredHostPatterns({
        manifest_version: 2,
        permissions: ['tabs', 'https://a.test/*', '<all_urls>', 'storage']
      })
    ).toEqual(['https://a.test/*', '<all_urls>'])
  })
})

describe('optionalHostPatterns', () => {
  it('reads optional_host_permissions on MV3 and optional_permissions on MV2', () => {
    expect(
      optionalHostPatterns({
        manifest_version: 3,
        optional_host_permissions: ['https://a.test/*']
      })
    ).toEqual(['https://a.test/*'])
    expect(
      optionalHostPatterns({
        manifest_version: 2,
        optional_permissions: ['bookmarks', 'https://a.test/*']
      })
    ).toEqual(['https://a.test/*'])
  })
})

describe('matchesHostPattern', () => {
  it.each([
    ['<all_urls>', 'https://anything.test/x', true],
    ['https://api.test/*', 'https://api.test/v1/ping', true],
    ['https://api.test/*', 'http://api.test/v1/ping', false],
    ['https://api.test/*', 'https://other.test/v1/ping', false],
    ['*://api.test/*', 'http://api.test/v1', true],
    ['*://api.test/*', 'ftp://api.test/v1', false],
    ['*://*.test/*', 'https://deep.sub.test/a', true],
    ['*://*.api.test/*', 'https://api.test/a', true],
    ['*://*.api.test/*', 'https://notapi.test/a', false],
    ['https://api.test/v1/*', 'https://api.test/v2/ping', false],
    ['https://api.test/v1/*', 'https://api.test/v1/ping', true],
    ['https://*/*', 'https://api.test/v1', true],
    ['not a pattern', 'https://api.test/', false]
  ])('%s vs %s', (pattern, url, expected) => {
    expect(matchesHostPattern(pattern, url)).toBe(expected)
  })
})

describe('findAbsoluteRequestUrls', () => {
  it('finds fetch, Request and XMLHttpRequest open targets', () => {
    const source = [
      "await fetch('https://one.test/a')",
      'const r = new Request("https://two.test/b")',
      'const xhr = new XMLHttpRequest()',
      "xhr.open('POST', `https://three.test/c`)"
    ].join('\n')
    expect(findAbsoluteRequestUrls(source).sort()).toEqual([
      'https://one.test/a',
      'https://three.test/c',
      'https://two.test/b'
    ])
  })

  it('ignores an open call in a file that never names XMLHttpRequest', () => {
    expect(
      findAbsoluteRequestUrls("db.open('GET', 'https://one.test/a')")
    ).toEqual([])
  })

  it('ignores relative fetches and the loopback dev server', () => {
    const source = [
      "fetch('/api/local')",
      "fetch('http://localhost:8080/hot/update.json')",
      "fetch('http://127.0.0.1:8080/hot/update.json')"
    ].join('\n')
    expect(findAbsoluteRequestUrls(source)).toEqual([])
  })
})

describe('isContentScriptModule', () => {
  it('reads the layer the content-script entries carry', () => {
    expect(isContentScriptModule({layer: 'extensionjs-content-script'})).toBe(
      true
    )
    expect(isContentScriptModule({})).toBe(false)
    expect(isContentScriptModule({layer: null})).toBe(false)
  })
})
