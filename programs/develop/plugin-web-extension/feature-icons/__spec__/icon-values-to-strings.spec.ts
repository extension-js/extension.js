import {describe, expect, it} from 'vitest'
import {iconValuesToStrings} from '../normalize-keys'

describe('iconValuesToStrings', () => {
  it('returns [] for nullish input', () => {
    expect(iconValuesToStrings(undefined)).toEqual([])
    expect(iconValuesToStrings(null)).toEqual([])
    expect(iconValuesToStrings('')).toEqual([])
  })

  it('wraps a single string path', () => {
    expect(iconValuesToStrings('icon.png')).toEqual(['icon.png'])
  })

  it('flattens an array of string paths', () => {
    expect(iconValuesToStrings(['a.png', 'b.png'])).toEqual(['a.png', 'b.png'])
  })

  it('flattens a size map ({ "16": ..., "48": ... })', () => {
    expect(
      iconValuesToStrings({'16': 'icon-16.png', '48': 'icon-48.png'})
    ).toEqual(['icon-16.png', 'icon-48.png'])
  })

  it('flattens a { light, dark } theme-icon object', () => {
    expect(iconValuesToStrings({light: 'light.png', dark: 'dark.png'})).toEqual(
      ['light.png', 'dark.png']
    )
  })

  it('flattens an array of theme-icon objects', () => {
    expect(
      iconValuesToStrings([
        {light: 'l1.png', dark: 'd1.png'},
        {light: 'l2.png', dark: 'd2.png'}
      ])
    ).toEqual(['l1.png', 'd1.png', 'l2.png', 'd2.png'])
  })

  it('drops non-string leaves', () => {
    expect(iconValuesToStrings(['a.png', 123 as any, null as any])).toEqual([
      'a.png'
    ])
    expect(iconValuesToStrings({size: 16 as any, path: 'a.png'})).toEqual([
      'a.png'
    ])
  })
})
