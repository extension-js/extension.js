import {describe, it, expect} from 'vitest'
import {icons} from '../icons'
import {action} from '../../mv3/action'

describe('icons manifest override — output path matches the icon emitter', () => {
  it('relocates relative icon paths to icons/<basename>', () => {
    const out = icons({
      icons: {16: 'images/i16.png', 32: 'i32.png'}
    } as any) as any
    expect(out.icons).toEqual({
      16: 'icons/i16.png',
      32: 'icons/i32.png'
    })
  })

  it('relocates leading-slash (extension-root) icon paths to icons/<basename>', () => {
    // Regression (Bug 06): a leading slash means extension-root, NOT public/.
    // The emitter writes these to icons/<basename>, so the manifest must agree —
    // the old code kept `images/...` and pointed at a file that was never there.
    const out = icons({
      icons: {16: '/images/get_started16.png', 32: '/images/get_started32.png'}
    } as any) as any
    expect(out.icons).toEqual({
      16: 'icons/get_started16.png',
      32: 'icons/get_started32.png'
    })
  })

  it('keeps genuine public/ icon paths at their extension-root location', () => {
    const out = icons({
      icons: {
        16: '/public/images/p.png',
        32: 'public/p32.png',
        48: './public/p48.png'
      }
    } as any) as any
    expect(out.icons).toEqual({
      16: 'images/p.png',
      32: 'p32.png',
      48: 'p48.png'
    })
  })

  it('applies the same rule to action.default_icon (object and string)', () => {
    const obj = action({
      action: {default_icon: {16: '/images/a16.png'}}
    } as any) as any
    expect(obj.action.default_icon).toEqual({16: 'icons/a16.png'})

    const str = action({
      action: {default_icon: '/images/a.png'}
    } as any) as any
    expect(str.action.default_icon).toBe('icons/a.png')
  })
})
