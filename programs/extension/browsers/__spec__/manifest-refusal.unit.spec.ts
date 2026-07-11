import {describe, it, expect} from 'vitest'
import {
  diagnoseChromiumManifestRefusal,
  findChromiumLoadBlockers,
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

// Each shape below was proven against a wild subject with CDP
// `Extensions.loadUnpacked`, which reports the reason --load-extension hides.
describe('findChromiumLoadBlockers', () => {
  it('flags a host wildcard Chrome refuses (CarbonWise: *://*carbonwise*/*)', () => {
    expect(
      findInvalidMatchPatterns({
        content_scripts: [
          {matches: ['*://*carbonwise*/*', 'https://*.zomato.com/*']}
        ]
      })
    ).toEqual(['*://*carbonwise*/*'])
  })

  it('keeps legal host wildcards out of the invalid list', () => {
    expect(
      findInvalidMatchPatterns({
        host_permissions: ['*://*/*', 'https://*.example.com/*'],
        content_scripts: [{matches: ['<all_urls>', 'https://stake.com/*/*']}]
      })
    ).toEqual([])
  })

  it('flags more than 4 keyboard shortcuts (spotify-hotkeys ships 12)', () => {
    const commands: Record<string, unknown> = {}
    for (let i = 0; i < 5; i++) {
      commands[`cmd-${i}`] = {suggested_key: {default: `Alt+Shift+${i}`}}
    }
    expect(findChromiumLoadBlockers({commands})).toEqual([
      'commands: 5 shortcuts declared with "suggested_key" — Chrome allows at most 4.'
    ])
  })

  it('does not flag 4 shortcuts, nor commands without suggested_key', () => {
    const commands: Record<string, unknown> = {
      _execute_action: {description: 'no suggested_key — not a shortcut'}
    }
    for (let i = 0; i < 4; i++) {
      commands[`cmd-${i}`] = {suggested_key: {default: `Alt+Shift+${i}`}}
    }
    expect(findChromiumLoadBlockers({commands})).toEqual([])
  })

  it('flags a content_scripts group with neither js nor css (fayufox)', () => {
    expect(
      findChromiumLoadBlockers({
        content_scripts: [
          {matches: ['*://*.mozilla.org/*'], js: [], css: []},
          {matches: ['*://*.example.com/*'], js: ['content.js']}
        ]
      })
    ).toEqual([
      'content_scripts[0]: declares neither "js" nor "css" — Chrome requires at least one.'
    ])
  })

  it('flags a malformed base64 manifest key (queup) but accepts a valid one', () => {
    expect(findChromiumLoadBlockers({key: 'MIIBIjANBgkqhkiG9w0BAQEF'})).toEqual(
      []
    )
    expect(findChromiumLoadBlockers({key: 'not-base64!!'})).toEqual([
      'key: not a valid base64 public key — Chrome refuses the extension.'
    ])
    // broken padding — queup's exact failure mode
    expect(findChromiumLoadBlockers({key: 'MIIBIjANBgkqhkiG9w0BAQE'})).toEqual([
      'key: not a valid base64 public key — Chrome refuses the extension.'
    ])
  })

  it('tolerates malformed and empty manifests', () => {
    expect(findChromiumLoadBlockers(undefined)).toEqual([])
    expect(findChromiumLoadBlockers({})).toEqual([])
    expect(
      findChromiumLoadBlockers({commands: 'x', content_scripts: 'y'})
    ).toEqual([])
  })
})
