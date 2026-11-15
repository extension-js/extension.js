import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  applyIconVariantsFallback,
  iconsFromVariants,
  ignoresIconVariants,
  reportIconVariantsFallback,
  resetIconVariantsNotice
} from '../icon-variants-fallback'
import {buildCanonicalManifest} from '../manifest'

const variants = [
  {16: 'icons/dark-16.png', 32: 'icons/dark-32.png', color_schemes: ['dark']},
  {16: 'icons/light-16.png', color_schemes: ['light']},
  {any: 'icons/any.svg'}
]

function capture() {
  const lines: string[] = []
  vi.spyOn(console, 'log').mockImplementation((line) => {
    lines.push(String(line))
  })

  return () => lines.join('\n').replace(/\u001b\[[0-9;]*m/g, '')
}

describe('icon_variants fallback', () => {
  afterEach(() => {
    resetIconVariantsNotice()
    vi.restoreAllMocks()
  })

  it('names the targets that skip the key', () => {
    expect(ignoresIconVariants('firefox')).toBe('gecko')
    expect(ignoresIconVariants('chrome')).toBe('chromium')
    expect(ignoresIconVariants('edge')).toBe('chromium')
    expect(ignoresIconVariants('safari')).toBeUndefined()
  })

  it('picks the all-scheme group, then light, and a vector only for Firefox', () => {
    expect(iconsFromVariants(variants, 'chromium')).toEqual({
      16: 'icons/light-16.png'
    })

    expect(
      iconsFromVariants([...variants, {48: 'icons/all-48.png'}], 'gecko')
    ).toEqual({48: 'icons/all-48.png'})

    expect(iconsFromVariants([{any: 'a.svg'}], 'gecko')).toEqual({
      48: 'a.svg',
      96: 'a.svg'
    })

    expect(iconsFromVariants([{any: 'a.svg'}], 'chromium')).toBeUndefined()
    expect(iconsFromVariants([{16: 'a.svg'}], 'chromium')).toBeUndefined()
  })

  it('keeps icons the manifest already has', () => {
    const manifest = {icons: {48: 'base.png'}, icon_variants: variants}
    const out = applyIconVariantsFallback(manifest as any, 'firefox')

    expect(out.manifest).toEqual(manifest)
    expect(out.verdicts).toEqual([{key: 'icons', outcome: 'kept'}])
  })

  it('adds icons and an action default_icon when the manifest has none', () => {
    const out = applyIconVariantsFallback(
      {icon_variants: variants, action: {icon_variants: variants}} as any,
      'chrome'
    )

    expect((out.manifest as any).icons).toEqual({16: 'icons/light-16.png'})
    expect((out.manifest as any).action.default_icon).toEqual({
      16: 'icons/light-16.png'
    })

    expect((out.manifest as any).icon_variants).toEqual(variants)
    expect(out.verdicts).toEqual([
      {key: 'icons', outcome: 'added'},
      {key: 'action.default_icon', outcome: 'added'}
    ])
  })

  it('leaves Safari and a manifest without the key untouched', () => {
    const manifest = {icon_variants: variants}

    expect(applyIconVariantsFallback(manifest as any, 'safari')).toEqual({
      manifest,
      verdicts: []
    })

    expect(
      applyIconVariantsFallback({icons: {16: 'a.png'}} as any, 'chrome')
        .verdicts
    ).toEqual([])
  })

  it('says what each target shows, once per process', () => {
    const text = capture()

    reportIconVariantsFallback([{key: 'icons', outcome: 'kept'}], 'firefox')
    reportIconVariantsFallback([{key: 'icons', outcome: 'kept'}], 'firefox')
    reportIconVariantsFallback([{key: 'icons', outcome: 'added'}], 'chrome')
    reportIconVariantsFallback([{key: 'icons', outcome: 'missing'}], 'chrome')
    reportIconVariantsFallback([{key: 'icons', outcome: 'kept'}], 'safari')

    expect(
      text().match(/Firefox does not read icon_variants yet/g)
    ).toHaveLength(1)

    expect(text()).toContain('Firefox shows icons from your manifest instead')
    expect(text()).toContain('ExtensionIconVariants')
    expect(text()).toContain(
      'The manifest had no icons, so the build filled it'
    )

    expect(text()).toContain('Add icons with PNG files to the manifest')
  })

  it('resolves chromium: and firefox: prefixes on the key through the build', () => {
    const text = capture()
    const manifest = {
      manifest_version: 3,
      name: 'x',
      version: '1',
      icons: {48: 'icons/base-48.png'},
      'chromium:icon_variants': [{16: '/icons/c-16.png'}],
      'firefox:icon_variants': [{16: 'icons/f-16.png'}]
    }
    const chrome = buildCanonicalManifest(
      '/p/manifest.json',
      manifest as any,
      'chrome'
    )
    const firefox = buildCanonicalManifest(
      '/p/manifest.json',
      manifest as any,
      'firefox'
    )
    const safari = buildCanonicalManifest(
      '/p/manifest.json',
      manifest as any,
      'safari'
    )

    expect((chrome as any).icon_variants).toEqual([{16: 'icons/c-16.png'}])
    expect((firefox as any).icon_variants).toEqual([{16: 'icons/f-16.png'}])
    expect((safari as any).icon_variants).toEqual([{16: 'icons/c-16.png'}])
    expect((chrome as any).icons).toEqual({48: 'icons/base-48.png'})
    expect(JSON.stringify(chrome)).not.toContain('chromium:')
    expect(text()).toContain('Chromium reads icon_variants only with')
    expect(text()).toContain('Firefox does not read icon_variants yet')
  })
})
