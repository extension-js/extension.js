import {describe, it, expect} from 'vitest'
import {theme} from '../theme'

describe('theme manifest override', () => {
  it('rewrites a single-string theme image to theme/images/<basename>', () => {
    const result = theme({
      theme: {
        images: {theme_frame: 'assets/header.png'},
        colors: {frame: '#000'}
      }
    } as any)

    expect(result).toEqual({
      theme: {
        images: {theme_frame: 'theme/images/header.png'},
        colors: {frame: '#000'}
      }
    })
  })

  it('rewrites an additional_backgrounds array without crashing on path.basename', () => {
    // Regression: `additional_backgrounds` is an array of paths; the override
    // used to pass it straight to path.basename() (string-only) and threw
    // ERR_INVALID_ARG_TYPE. It must map over the array instead.
    const result = theme({
      theme: {
        images: {
          additional_backgrounds: ['weta.png', 'nested/weta-left.png']
        },
        properties: {
          additional_backgrounds_alignment: ['right top', 'left top']
        }
      }
    } as any) as any

    expect(result.theme.images.additional_backgrounds).toEqual([
      'theme/images/weta.png',
      'theme/images/weta-left.png'
    ])
    // Non-image fields pass through untouched.
    expect(result.theme.properties.additional_backgrounds_alignment).toEqual([
      'right top',
      'left top'
    ])
  })

  it('handles a mix of string and array image fields', () => {
    const result = theme({
      theme: {
        images: {
          theme_frame: 'frame.png',
          additional_backgrounds: ['a.png', 'b.png']
        }
      }
    } as any) as any

    expect(result.theme.images).toEqual({
      theme_frame: 'theme/images/frame.png',
      additional_backgrounds: ['theme/images/a.png', 'theme/images/b.png']
    })
  })

  it('returns falsy when there is no theme', () => {
    expect(theme({name: 'x'} as any)).toBeFalsy()
  })
})
