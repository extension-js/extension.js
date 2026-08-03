import {describe, expect, it} from 'vitest'
import {parseHexThemeColor} from '../manifest-lib/theme-values'
import {patchChromiumThemeColors} from '../steps/patch-chromium-theme-colors'

describe('parseHexThemeColor', () => {
  it('parses long-form hex', () => {
    expect(parseHexThemeColor('#ff0000')).toEqual([255, 0, 0])
    expect(parseHexThemeColor('#FFFFFF')).toEqual([255, 255, 255])
  })

  it('parses shorthand hex', () => {
    expect(parseHexThemeColor('#000')).toEqual([0, 0, 0])
    expect(parseHexThemeColor('#e53')).toEqual([238, 85, 51])
  })

  it('parses alpha forms into a 0-1 alpha channel', () => {
    expect(parseHexThemeColor('#00000000')).toEqual([0, 0, 0, 0])
    expect(parseHexThemeColor('#000000ff')).toEqual([0, 0, 0, 1])
    expect(parseHexThemeColor('#00000080')).toEqual([0, 0, 0, 0.502])
    expect(parseHexThemeColor('#000f')).toEqual([0, 0, 0, 1])
  })

  it('rejects everything that is not a hex color string', () => {
    expect(parseHexThemeColor('red')).toBeUndefined()
    expect(parseHexThemeColor('rgb(0, 0, 0)')).toBeUndefined()
    expect(parseHexThemeColor('#00')).toBeUndefined()
    expect(parseHexThemeColor('#ggg')).toBeUndefined()
    expect(parseHexThemeColor('000000')).toBeUndefined()
    expect(parseHexThemeColor([0, 0, 0])).toBeUndefined()
    expect(parseHexThemeColor(undefined)).toBeUndefined()
  })
})

describe('patchChromiumThemeColors', () => {
  const themedManifest = (colors: Record<string, unknown>) =>
    ({
      manifest_version: 3,
      name: 'x',
      version: '1.0.0',
      theme: {colors, images: {theme_frame: 'frame.png'}}
    }) as any

  it('converts hex colors to arrays for chromium targets', () => {
    const patched: any = patchChromiumThemeColors(
      themedManifest({tab_text: '#000', frame: '#e53935', bg: '#00000080'}),
      'chrome'
    )
    expect(patched.theme.colors).toEqual({
      tab_text: [0, 0, 0],
      frame: [229, 57, 53],
      bg: [0, 0, 0, 0.502]
    })
  })

  it('keeps sibling theme keys and non-hex values untouched', () => {
    const patched: any = patchChromiumThemeColors(
      themedManifest({frame: '#000', toolbar: [1, 2, 3], odd: 'red'}),
      'chromium'
    )
    expect(patched.theme.images).toEqual({theme_frame: 'frame.png'})
    expect(patched.theme.colors.toolbar).toEqual([1, 2, 3])
    expect(patched.theme.colors.odd).toBe('red')
  })

  it('returns the manifest unchanged for gecko targets', () => {
    const manifest = themedManifest({frame: '#000'})
    expect(patchChromiumThemeColors(manifest, 'firefox')).toBe(manifest)
  })

  it('returns the manifest unchanged without convertible colors', () => {
    const manifest = themedManifest({frame: [0, 0, 0]})
    expect(patchChromiumThemeColors(manifest, 'chrome')).toBe(manifest)
    const themeless = {manifest_version: 3, name: 'x', version: '1.0.0'} as any
    expect(patchChromiumThemeColors(themeless, 'chrome')).toBe(themeless)
  })
})
