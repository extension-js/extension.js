import {describe, expect, it} from 'vitest'
import {omnibox} from '../omnibox'

describe('omnibox (default_icon override)', () => {
  it('keeps the manifest-relative location the icons emitter uses', () => {
    const result = omnibox({
      omnibox: {keyword: 'ex', default_icon: 'images/omni.png'}
    } as any)
    expect(result?.omnibox.default_icon).toBe('images/omni.png')
  })

  it('names the public-relative path for public-hosted icons', () => {
    const result = omnibox({
      omnibox: {
        keyword: 'ex',
        default_icon: {'16': 'public/omni16.png', '32': '/omni32.png'}
      }
    } as any)
    expect(result?.omnibox.default_icon).toEqual({
      '16': 'omni16.png',
      '32': 'omni32.png'
    })
  })
})
