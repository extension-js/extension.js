import {describe, it, expect} from 'vitest'
import {filterKeysForThisBrowser} from '../manifest'

// This exercises the manifest-lib copy of filterKeysForThisBrowser that runs in
// the live manifest-emission path (buildCanonicalManifest). It must stay in sync
// with lib/manifest-utils.ts; both treat Safari/webkit as the chromium family.
describe('filterKeysForThisBrowser (manifest-lib) — Safari', () => {
  const manifest = {
    name: 'x',
    'chromium:manifest_version': 3,
    'firefox:manifest_version': 2,
    'chromium:action': {default_title: 'Chromium'},
    'firefox:action': {default_title: 'Firefox'}
  } as any

  it('resolves chromium manifest_version and keys for safari', () => {
    const patched = filterKeysForThisBrowser(manifest, 'safari') as any
    expect(patched.manifest_version).toBe(3)
    expect(patched.action).toEqual({default_title: 'Chromium'})
  })

  it('resolves chromium keys for webkit-based targets', () => {
    const patched = filterKeysForThisBrowser(
      manifest,
      'webkit-based' as any
    ) as any
    expect(patched.manifest_version).toBe(3)
  })

  it('still resolves gecko keys for firefox (no chromium bleed-through)', () => {
    const patched = filterKeysForThisBrowser(manifest, 'firefox') as any
    expect(patched.manifest_version).toBe(2)
    expect(patched.action).toEqual({default_title: 'Firefox'})
  })
})
