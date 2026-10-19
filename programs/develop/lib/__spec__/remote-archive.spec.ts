import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  remoteArchiveCacheKey,
  remoteArchiveCacheRoot,
  repairPastedUrl,
  tokenExpiry
} from '../remote-archive'

function jwt(payload: Record<string, unknown>) {
  const header = Buffer.from('{"alg":"HS256"}').toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')

  return `${header}.${body}.c2lnbmF0dXJl`
}

describe('repairPastedUrl', () => {
  it('drops the whitespace a wrapped line puts inside a link', () => {
    const pasted =
      'https://registry.example/ws/project/builds/abc/chrome.zip?t=InBp aS1z.YTJjM\t2Q2\n'

    expect(repairPastedUrl(pasted)).toEqual({
      url: 'https://registry.example/ws/project/builds/abc/chrome.zip?t=InBpaS1z.YTJjM2Q2',
      repaired: true
    })
  })

  it('leaves a clean link alone', () => {
    const url = 'https://registry.example/chrome.zip?t=abc.def'

    expect(repairPastedUrl(url)).toEqual({url, repaired: false})
  })
})

describe('tokenExpiry', () => {
  const now = Date.UTC(2026, 9, 19, 12, 0, 0)

  it('reads an exp claim in seconds from a JWT token', () => {
    const exp = Math.floor(now / 1000) - 3600
    const url = `https://registry.example/chrome.zip?t=${jwt({sub: 'x', exp})}`

    expect(tokenExpiry(url, now)).toEqual({
      at: new Date(exp * 1000),
      expired: true
    })
  })

  it('calls a future expiry not expired', () => {
    const exp = Math.floor(now / 1000) + 3600
    const url = `https://registry.example/chrome.zip?t=${jwt({exp})}`

    expect(tokenExpiry(url, now)?.expired).toBe(false)
  })

  it('accepts an exp claim in milliseconds and a token query name', () => {
    const exp = now + 60_000
    const url = `https://registry.example/chrome.zip?token=${jwt({exp})}`

    expect(tokenExpiry(url, now)).toEqual({at: new Date(exp), expired: false})
  })

  it('reads a bare base64 JSON token', () => {
    const exp = Math.floor(now / 1000) - 1
    const token = Buffer.from(JSON.stringify({exp})).toString('base64url')

    expect(
      tokenExpiry(`https://registry.example/a.zip?t=${token}`, now)
    ).toEqual({at: new Date(exp * 1000), expired: true})
  })

  it.each([
    ['no token', 'https://registry.example/chrome.zip'],
    [
      'an opaque token',
      'https://registry.example/chrome.zip?t=0123456789abcdef'
    ],
    [
      'a token with no exp',
      `https://registry.example/a.zip?t=${jwt({sub: 'x'})}`
    ],
    ['no url at all', 'not a url']
  ])('reads no expiry from %s', (_label, url) => {
    expect(tokenExpiry(url, now)).toBeUndefined()
  })
})

describe('remoteArchiveCacheRoot', () => {
  it('honors XDG_CACHE_HOME on every platform', () => {
    expect(
      remoteArchiveCacheRoot(
        {XDG_CACHE_HOME: '/xdg', HOME: '/home/u'},
        'darwin'
      )
    ).toBe(path.join('/xdg', 'extension.js', 'previews'))
  })

  it('uses Library/Caches on macOS', () => {
    expect(remoteArchiveCacheRoot({HOME: '/Users/u'}, 'darwin')).toBe(
      path.join('/Users/u', 'Library', 'Caches', 'extension.js', 'previews')
    )
  })

  it('uses ~/.cache elsewhere', () => {
    expect(remoteArchiveCacheRoot({HOME: '/home/u'}, 'linux')).toBe(
      path.join('/home/u', '.cache', 'extension.js', 'previews')
    )
  })

  it('reads USERPROFILE when HOME is unset', () => {
    expect(remoteArchiveCacheRoot({USERPROFILE: 'C:\\Users\\u'}, 'win32')).toBe(
      path.join('C:\\Users\\u', '.cache', 'extension.js', 'previews')
    )
  })
})

describe('remoteArchiveCacheKey', () => {
  const url =
    'https://registry.extension.land/cezaraugusto/pii-shield/builds/b418732/chrome.zip?t=secret'

  it('spells the url path out and ends with a digest', () => {
    expect(remoteArchiveCacheKey(url)).toMatch(
      /^cezaraugusto-pii-shield-builds-b418732-chrome-[0-9a-f]{8}$/
    )
  })

  it('ignores the query, so a new share token lands on the same copy', () => {
    expect(remoteArchiveCacheKey(url.replace('secret', 'other'))).toBe(
      remoteArchiveCacheKey(url)
    )
  })

  it('tells two hosts with one path apart', () => {
    const elsewhere = url.replace('registry.extension.land', 'mirror.example')

    expect(remoteArchiveCacheKey(elsewhere)).not.toBe(
      remoteArchiveCacheKey(url)
    )

    expect(remoteArchiveCacheKey(elsewhere).slice(0, -9)).toBe(
      remoteArchiveCacheKey(url).slice(0, -9)
    )
  })

  it('keeps the slug to file-name characters and a bounded length', () => {
    const key = remoteArchiveCacheKey(
      `https://h.example/${'a'.repeat(120)}/we%20ird!name/.hidden/x.zip`
    )

    expect(key).toMatch(/^[A-Za-z0-9._-]+-[0-9a-f]{8}$/)
    expect(key.length).toBeLessThanOrEqual(89)
    expect(key.startsWith('a')).toBe(true)
  })

  it('names an archive served from the root', () => {
    expect(remoteArchiveCacheKey('https://h.example/')).toMatch(
      /^archive-[0-9a-f]{8}$/
    )
  })
})
