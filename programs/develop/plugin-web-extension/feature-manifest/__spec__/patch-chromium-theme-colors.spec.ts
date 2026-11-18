import {describe, expect, it} from 'vitest'
import {translateThemeColor} from '../manifest-lib/theme-values'
import {
  patchChromiumThemeColors,
  translatedThemeColors
} from '../steps/patch-chromium-theme-colors'

describe('translateThemeColor', () => {
  it('reads six and three digit hex in either case', () => {
    expect(translateThemeColor('#ff0000')).toEqual([255, 0, 0])
    expect(translateThemeColor('#FFFFFF')).toEqual([255, 255, 255])
    expect(translateThemeColor('#e53')).toEqual([238, 85, 51])
    expect(translateThemeColor(' #000 ')).toEqual([0, 0, 0])
  })

  it('reads rgb() with three whole channels', () => {
    expect(translateThemeColor('rgb(0, 0, 0)')).toEqual([0, 0, 0])
    expect(translateThemeColor('RGB(255,128,0)')).toEqual([255, 128, 0])
  })

  // Each of these has no single exact [R, G, B] reading, or needs a table
  // the author should see, so the build refuses instead of guessing.
  it.each([
    '#00000080',
    '#000f',
    'rgba(255, 0, 0, 0.5)',
    'rgb(0, 0, 0, 1)',
    'rgb(100%, 0%, 0%)',
    'rgb(300, 0, 0)',
    'rgb(0, 0)',
    'hsl(0, 100%, 50%)',
    'red',
    'transparent',
    '#00',
    '#ggg',
    '000000'
  ])('leaves %s untranslated', (value) => {
    expect(translateThemeColor(value)).toBeUndefined()
  })

  it('leaves non-strings untranslated', () => {
    expect(translateThemeColor([0, 0, 0])).toBeUndefined()
    expect(translateThemeColor(undefined)).toBeUndefined()
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

  it('writes hex and rgb() as arrays for chromium targets and names them', () => {
    const manifest = themedManifest({
      tab_text: '#000',
      frame: '#e53935',
      toolbar: 'rgb(1, 2, 3)',
      bar: [4, 5, 6]
    })
    const patched: any = patchChromiumThemeColors(manifest, 'chrome')

    expect(patched.theme.colors).toEqual({
      tab_text: [0, 0, 0],
      frame: [229, 57, 53],
      toolbar: [1, 2, 3],
      bar: [4, 5, 6]
    })

    expect(patched.theme.images).toEqual({theme_frame: 'frame.png'})
    expect(manifest.theme.colors.frame).toBe('#e53935')
    expect(
      translatedThemeColors(manifest, 'chromium').map(({key}) => key)
    ).toEqual(['tab_text', 'frame', 'toolbar'])
  })

  it('returns gecko manifests unchanged and names nothing', () => {
    const manifest = themedManifest({frame: '#000'})
    expect(patchChromiumThemeColors(manifest, 'firefox')).toBe(manifest)
    expect(translatedThemeColors(manifest, 'firefox')).toEqual([])
  })

  it('returns the manifest unchanged with nothing to translate', () => {
    const manifest = themedManifest({frame: [0, 0, 0]})
    expect(patchChromiumThemeColors(manifest, 'chrome')).toBe(manifest)
    expect(translatedThemeColors(manifest, 'chrome')).toEqual([])
    const themeless = {manifest_version: 3, name: 'x', version: '1.0.0'} as any
    expect(patchChromiumThemeColors(themeless, 'chrome')).toBe(themeless)
  })
})
