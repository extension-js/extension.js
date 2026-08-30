import * as parse5utilities from 'parse5-utilities'
import {describe, expect, it} from 'vitest'
import {
  cleanAssetUrl,
  getBaseHref,
  isUrl,
  rewriteSrcsetCandidate
} from '../../html-lib/utils'

describe('html-lib utils', () => {
  it('cleanAssetUrl splits path, query and hash', () => {
    const r1 = cleanAssetUrl('img/a.png?x=1#h')
    expect(r1).toEqual({cleanPath: 'img/a.png', search: '?x=1', hash: '#h'})
    const r2 = cleanAssetUrl('img/a.png#h?ignored')
    expect(r2).toEqual({
      cleanPath: 'img/a.png',
      search: '',
      hash: '#h?ignored'
    })
    const r3 = cleanAssetUrl('img/a.png')
    expect(r3).toEqual({cleanPath: 'img/a.png', search: '', hash: ''})
  })

  it('isUrl detects absolute urls', () => {
    expect(isUrl('https://x.com')).toBe(true)
    expect(isUrl('http://x.com')).toBe(true)
    expect(isUrl('/x.png')).toBe(false)
    expect(isUrl('x.png')).toBe(false)
  })

  it('rewriteSrcsetCandidate replaces one URL and keeps descriptors', () => {
    expect(
      rewriteSrcsetCandidate(
        'hero.png 1x, hero-2x.png 2x',
        'hero.png',
        '/assets/hero.png'
      )
    ).toBe('/assets/hero.png 1x, hero-2x.png 2x')
    expect(
      rewriteSrcsetCandidate(
        '/assets/hero.png 1x, hero-2x.png 2x',
        'hero-2x.png',
        '/assets/hero-2x.png'
      )
    ).toBe('/assets/hero.png 1x, /assets/hero-2x.png 2x')
  })

  it('getBaseHref returns <base href> when present', () => {
    const doc = parse5utilities.parse(
      '<html><head><base href="/sub/"></head><body></body></html>'
    )
    expect(getBaseHref(doc as any)).toBe('/sub/')
    const doc2 = parse5utilities.parse(
      '<html><head></head><body></body></html>'
    )
    expect(getBaseHref(doc2 as any)).toBeUndefined()
  })
})
