import {describe, it, expect} from 'vitest'
import {
  diagnoseChromiumManifestRefusal,
  findInvalidMatchPatterns
} from '../browsers-lib/manifest-refusal'

// Launch-time honesty for manifest shapes Chromium refuses to load AT ALL:
// the refusal surfaces as a native modal or as nothing (no console error, no
// CDP target), so dev must say why before the spawn. MV2 was already
// diagnosed; Firefox-style MV3 `background.scripts` without a service_worker
// is the second shape (MelonTranslate / spotify-hotkeys-firefox cluster).
describe('diagnoseChromiumManifestRefusal', () => {
  it('flags MV2', () => {
    expect(diagnoseChromiumManifestRefusal({manifest_version: 2})).toBe('mv2')
  })

  it('flags MV3 with Firefox-style background.scripts and no service_worker', () => {
    expect(
      diagnoseChromiumManifestRefusal({
        manifest_version: 3,
        background: {scripts: ['background.js']}
      })
    ).toBe('mv3-background-scripts')
  })

  it('accepts MV3 with a service_worker (even alongside scripts)', () => {
    expect(
      diagnoseChromiumManifestRefusal({
        manifest_version: 3,
        background: {service_worker: 'sw.js'}
      })
    ).toBeNull()
    // Dual-declared manifests load on Chromium (it uses the worker) — the
    // scripts array is Firefox's half of a cross-browser manifest.
    expect(
      diagnoseChromiumManifestRefusal({
        manifest_version: 3,
        background: {service_worker: 'sw.js', scripts: ['background.js']}
      })
    ).toBeNull()
  })

  it('flags match patterns with a query string, fragment, or port (wild: Ban-Checker, Better-Names)', () => {
    const invalid = findInvalidMatchPatterns({
      manifest_version: 3,
      host_permissions: ['*://steamcommunity.com/*'],
      content_scripts: [
        {
          matches: [
            '*://steamcommunity.com/id/*/gcpd/730?tab=majors',
            'http://in.7fa4.cn:8888/review/*',
            'https://example.com/page#section'
          ],
          js: ['content.js']
        }
      ],
      web_accessible_resources: [
        {resources: ['a.js'], matches: ['https://ok.example/*']}
      ]
    })
    expect(invalid).toEqual([
      '*://steamcommunity.com/id/*/gcpd/730?tab=majors',
      'http://in.7fa4.cn:8888/review/*',
      'https://example.com/page#section'
    ])
  })

  it('accepts valid patterns, <all_urls>, and IPs without ports', () => {
    expect(
      findInvalidMatchPatterns({
        host_permissions: [
          '<all_urls>',
          '*://steamcommunity.com/id/*/gcpd/730*tab=majors',
          'http://10.210.57.10/*',
          'file:///*'
        ],
        content_scripts: [{matches: ['https://*.example.com/deep/path*']}]
      })
    ).toEqual([])
    expect(findInvalidMatchPatterns(undefined)).toEqual([])
  })

  it('accepts MV3 with no background and tolerates malformed shapes', () => {
    expect(diagnoseChromiumManifestRefusal({manifest_version: 3})).toBeNull()
    expect(
      diagnoseChromiumManifestRefusal({
        manifest_version: 3,
        background: {scripts: []}
      })
    ).toBeNull()
    expect(diagnoseChromiumManifestRefusal(undefined)).toBeNull()
    expect(
      diagnoseChromiumManifestRefusal({manifest_version: 3, background: 'x'})
    ).toBeNull()
  })
})
