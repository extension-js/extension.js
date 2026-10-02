import {describe, expect, it} from 'vitest'
import {getManifestOverrides} from '../../manifest-overrides'
import {hasUnsupportedMv3BackgroundPage} from '../../steps/patch-chromium-background'

describe('getManifestOverrides, dual background keys (G14)', () => {
  it('rewrites BOTH service_worker and scripts to their canonical bundle paths', () => {
    const manifest = {
      manifest_version: 3,
      background: {
        service_worker: 'Background/BackgroundModule.js',
        scripts: ['Background/BackgroundModule.js'],
        type: 'module'
      }
    }

    const parsed = JSON.parse(
      getManifestOverrides('/m/manifest.json', manifest as any, {} as any)
    )

    expect(parsed.background.service_worker).toBe(
      'background/service_worker.js'
    )

    expect(parsed.background.scripts).toEqual(['background/scripts.js'])
    expect(parsed.background.type).toBe('module')
  })

  it('still rewrites a single background.scripts (MV2) without touching siblings', () => {
    const manifest = {
      manifest_version: 2,
      background: {scripts: ['a.js', 'b.js'], persistent: false}
    }

    const parsed = JSON.parse(
      getManifestOverrides('/m/manifest.json', manifest as any, {} as any)
    )

    expect(parsed.background.scripts).toEqual(['background/scripts.js'])
    expect(parsed.background.persistent).toBe(false)
    expect(parsed.background.service_worker).toBeUndefined()
  })

  it('still rewrites an MV3 background.page for the browsers that read it', () => {
    const parsed = JSON.parse(
      getManifestOverrides(
        '/m/manifest.json',
        {manifest_version: 3, background: {page: 'bg/index.html'}} as any,
        {} as any
      )
    )

    expect(parsed.background.page).toBe('background/index.html')
  })
})

describe('MV3 background.page by browser', () => {
  const withPage = {manifest_version: 3, background: {page: 'bg/index.html'}}

  it('is unsupported on chromium', () => {
    expect(hasUnsupportedMv3BackgroundPage(withPage as any, 'chrome')).toBe(
      true
    )
  })

  it('is supported on gecko and webkit', () => {
    expect(hasUnsupportedMv3BackgroundPage(withPage as any, 'firefox')).toBe(
      false
    )

    expect(hasUnsupportedMv3BackgroundPage(withPage as any, 'safari')).toBe(
      false
    )
  })

  it('is supported on MV2 and beside a runnable MV3 entry', () => {
    expect(
      hasUnsupportedMv3BackgroundPage(
        {manifest_version: 2, background: {page: 'bg/index.html'}} as any,
        'chrome'
      )
    ).toBe(false)

    expect(
      hasUnsupportedMv3BackgroundPage(
        {
          manifest_version: 3,
          background: {page: 'bg/index.html', service_worker: 'sw.js'}
        } as any,
        'chrome'
      )
    ).toBe(false)

    expect(
      hasUnsupportedMv3BackgroundPage(
        {
          manifest_version: 3,
          background: {page: 'bg/index.html', scripts: ['bg.js']}
        } as any,
        'chrome'
      )
    ).toBe(false)
  })
})
