import {describe, expect, it} from 'vitest'
import {action} from '../../mv3/action'
import {icons} from '../icons'

describe('icons manifest override, output path matches the icon emitter', () => {
  it('preserves in-project relative icon paths as declared', () => {
    // Regression (G16): flattening every icon to icons/<basename> collides
    // with any other emitted asset that legitimately owns icons/<basename>
    // (e.g. a popup-referenced image) and silently aliases two different
    // icons that share a basename. In-project paths are preserved instead.
    const out = icons({
      icons: {16: 'images/i16.png', 32: 'i32.png'}
    } as any) as any
    expect(out.icons).toEqual({
      16: 'images/i16.png',
      32: 'i32.png'
    })
  })

  it('preserves distinct same-basename icons living in different folders', () => {
    const out = icons({
      icons: {48: 'icons-dev/icon48.png'}
    } as any) as any
    expect(out.icons).toEqual({48: 'icons-dev/icon48.png'})
  })

  it('treats leading-slash (extension-root) icon paths as project-relative', () => {
    // Bug 06 invariant: the manifest must point where the emitter writes.
    // The emitter resolves "/images/x.png" to <project>/images/x.png and
    // (since G16) emits it at images/x.png, so the manifest agrees.
    const out = icons({
      icons: {16: '/images/get_started16.png', 32: '/images/get_started32.png'}
    } as any) as any
    expect(out.icons).toEqual({
      16: 'images/get_started16.png',
      32: 'images/get_started32.png'
    })
  })

  it('flattens paths that escape the project to icons/<basename>', () => {
    const out = icons({
      icons: {16: '../shared/i16.png'}
    } as any) as any
    expect(out.icons).toEqual({16: 'icons/i16.png'})
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
    expect(obj.action.default_icon).toEqual({16: 'images/a16.png'})

    const str = action({
      action: {default_icon: 'icons-dev/a.png'}
    } as any) as any
    expect(str.action.default_icon).toBe('icons-dev/a.png')
  })
})
