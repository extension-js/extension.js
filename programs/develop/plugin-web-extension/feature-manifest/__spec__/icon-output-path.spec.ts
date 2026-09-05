import {describe, expect, it} from 'vitest'
import {
  externalAssetOutputPath,
  iconOutputPath,
  themeIconOutputPath,
  themeImageOutputPath
} from '../normalize-manifest-path'

describe('iconOutputPath', () => {
  it('gives distinct outside-root sources sharing a basename distinct outputs', () => {
    expect(iconOutputPath('../a/logo.png')).not.toBe(
      iconOutputPath('../b/logo.png')
    )
    expect(iconOutputPath('C:/one/logo.png')).not.toBe(
      iconOutputPath('D:/two/logo.png')
    )
  })

  it('keeps in-project paths verbatim', () => {
    expect(iconOutputPath('icons/x.png')).toBe('icons/x.png')
    expect(iconOutputPath('logo.png')).toBe('logo.png')
    expect(iconOutputPath('./assets/icon.png')).toBe('assets/icon.png')
  })

  it('still strips the public prefix', () => {
    expect(iconOutputPath('public/logo.png')).toBe('logo.png')
    expect(iconOutputPath('./public/logo.png')).toBe('logo.png')
    expect(iconOutputPath('/public/logo.png')).toBe('logo.png')
  })

  it('is deterministic and lands escaping sources under icons/', () => {
    expect(iconOutputPath('../a/logo.png')).toBe(
      iconOutputPath('../a/logo.png')
    )
    expect(iconOutputPath('../a/logo.png')).toBe('icons/_/a/logo.png')
    expect(iconOutputPath('C:/one/logo.png')).toBe(
      'icons/_drive_C/one/logo.png'
    )
  })
})

describe('themeIconOutputPath', () => {
  it('keeps in-project theme icons at their own path under the folder', () => {
    expect(themeIconOutputPath('icons/light.png', 'action')).toBe(
      'action/icons/light.png'
    )
    expect(themeIconOutputPath('images/dark.png', 'browser_action')).toBe(
      'browser_action/images/dark.png'
    )
  })

  it('keeps a light/dark pair inside the root apart', () => {
    const light = themeIconOutputPath('icons/light/icon.png', 'browser_action')
    const dark = themeIconOutputPath('icons/dark/icon.png', 'browser_action')
    expect(light).not.toBe(dark)
    expect(light).toBe('browser_action/icons/light/icon.png')
  })

  it('keeps a light/dark pair outside the root apart', () => {
    const light = themeIconOutputPath('../design/light/logo.png', 'action')
    const dark = themeIconOutputPath('../design/dark/logo.png', 'action')
    expect(light).not.toBe(dark)
    expect(light).toBe('action/_/design/light/logo.png')
  })

  it('leaves public-hosted theme icons at the extension root', () => {
    expect(themeIconOutputPath('public/light.png', 'action')).toBe('light.png')
  })
})

describe('themeImageOutputPath', () => {
  it('keeps same-basename theme images apart under theme/images', () => {
    const light = themeImageOutputPath('images/light/bg.png')
    const dark = themeImageOutputPath('images/dark/bg.png')
    expect(light).toBe('theme/images/images/light/bg.png')
    expect(dark).toBe('theme/images/images/dark/bg.png')
  })

  it('gives an outside-root image a slot and leaves public ones alone', () => {
    expect(themeImageOutputPath('../design/bg.png')).toBe(
      'theme/images/_/design/bg.png'
    )
    expect(themeImageOutputPath('public/bg.png')).toBe('bg.png')
  })
})

describe('externalAssetOutputPath', () => {
  it('names an empty path with a stable fallback', () => {
    expect(externalAssetOutputPath('', 'icons')).toBe('icons/external')
  })
})
