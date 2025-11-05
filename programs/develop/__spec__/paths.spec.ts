import {describe, it, expect} from 'vitest'
import {unixify, shouldExclude, getFilename} from '../webpack/webpack-lib/paths'

describe('paths helpers', () => {
  it('unixify converts backslashes', () => {
    expect(unixify('a\\b\\c')).toBe('a/b/c')
  })

  it('shouldExclude matches exact and child paths', () => {
    const ignore = {
      'public/': 'public/',
      assets: 'assets'
    } as any
    expect(shouldExclude('public/logo.png', ignore)).toBe(true)
    expect(shouldExclude('assets/img/x.png', ignore)).toBe(true)
    expect(shouldExclude('scripts/main.ts', ignore)).toBe(false)
  })

  it('getFilename rewrites extensions and honors public mapping', () => {
    const exclude = {
      'public/': 'public/logo.png'
    } as any
    const out = getFilename('feature', 'public/logo.png', exclude)
    expect(out).toBe('logo.png')
    const out2 = getFilename('feature', 'scripts/app.ts', {})
    expect(out2).toBe('feature.js')
  })
})
