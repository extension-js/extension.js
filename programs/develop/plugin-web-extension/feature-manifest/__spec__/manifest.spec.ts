import {describe, expect, it} from 'vitest'
import {
  filterKeysForThisBrowser,
  findDroppedVendorKeys
} from '../../../lib/manifest-utils'
import {asBrowser, asManifest} from './helpers/manifest-fakes'

describe('filterKeysForThisBrowser', () => {
  it('keeps plain keys and applies chromium-prefixed overrides', () => {
    const manifest = asManifest({
      name: 'x',
      version: '1.0.0',
      'chromium:action': {default_title: 'Chromium'},
      'firefox:action': {default_title: 'Firefox'}
    })

    const patched = filterKeysForThisBrowser(manifest, 'chrome')
    expect(patched.name).toBe('x')
    expect(patched.version).toBe('1.0.0')
    expect(patched.action).toEqual({default_title: 'Chromium'})
    expect(patched['firefox:action']).toBeUndefined()
  })

  it('applies gecko-prefixed overrides for firefox', () => {
    const manifest = asManifest({
      name: 'x',
      'gecko:action': {default_title: 'Gecko'},
      'chrome:action': {default_title: 'Chrome'}
    })

    const patched = filterKeysForThisBrowser(manifest, 'firefox')
    expect(patched.action).toEqual({default_title: 'Gecko'})
    expect(patched['chrome:action']).toBeUndefined()
  })

  it('resolves chromium-prefixed keys for safari (MV3 chromium-shaped bundle)', () => {
    const manifest = asManifest({
      name: 'x',
      'chromium:manifest_version': 3,
      'firefox:manifest_version': 2,
      'chromium:action': {default_title: 'Chromium'},
      'firefox:action': {default_title: 'Firefox'}
    })

    const patched = filterKeysForThisBrowser(manifest, 'safari')
    expect(patched.manifest_version).toBe(3)
    expect(patched.action).toEqual({default_title: 'Chromium'})
    expect(patched['firefox:action']).toBeUndefined()
  })

  it('keeps source order between sibling family prefixes, the later key wins', () => {
    // Neither gecko: nor firefox: is the specific prefix on a waterfox build.
    const firefoxLast = asManifest({
      'gecko:action': {default_title: 'Gecko'},
      'firefox:action': {default_title: 'Firefox'}
    })
    expect(filterKeysForThisBrowser(firefoxLast, 'waterfox').action).toEqual({
      default_title: 'Firefox'
    })

    const geckoLast = asManifest({
      'firefox:action': {default_title: 'Firefox'},
      'gecko:action': {default_title: 'Gecko'}
    })
    expect(filterKeysForThisBrowser(geckoLast, 'waterfox').action).toEqual({
      default_title: 'Gecko'
    })
  })

  describe('vendor-exact chrome: and edge:', () => {
    const manifest = asManifest({
      name: 'x',
      'chrome:key': 'store-key',
      'chromium:action': {default_title: 'Chromium'},
      'edge:action': {default_title: 'Edge'}
    })

    it('applies chrome: only to a chrome build', () => {
      expect(filterKeysForThisBrowser(manifest, 'chrome').key).toBe('store-key')

      for (const browser of [
        'edge',
        'chromium',
        'chromium-based',
        'brave',
        'safari'
      ]) {
        expect(
          filterKeysForThisBrowser(manifest, asBrowser(browser))
        ).not.toHaveProperty('key')
      }
    })

    it('applies edge: only to an edge build, over the chromium: family key', () => {
      expect(filterKeysForThisBrowser(manifest, 'edge').action).toEqual({
        default_title: 'Edge'
      })

      for (const browser of ['chrome', 'chromium', 'brave', 'safari']) {
        expect(
          filterKeysForThisBrowser(manifest, asBrowser(browser)).action
        ).toEqual({default_title: 'Chromium'})
      }
    })

    it('ranks the vendor key over the family key regardless of order', () => {
      const vendorFirst = asManifest({
        'chrome:action': {default_title: 'Chrome'},
        'chromium:action': {default_title: 'Chromium'},
        action: {default_title: 'Plain'}
      })
      expect(filterKeysForThisBrowser(vendorFirst, 'chrome').action).toEqual({
        default_title: 'Chrome'
      })

      expect(filterKeysForThisBrowser(vendorFirst, 'edge').action).toEqual({
        default_title: 'Chromium'
      })
    })

    it('leaves chrome: and edge: out of gecko builds', () => {
      expect(filterKeysForThisBrowser(manifest, 'firefox')).toEqual({
        name: 'x'
      })
    })
  })
})

describe('findDroppedVendorKeys', () => {
  it('names each chrome: or edge: key another chromium target drops', () => {
    const manifest = asManifest({
      'chrome:key': 'store-key',
      background: {'edge:service_worker': 'sw.js'},
      content_scripts: [{'chrome:js': ['a.js']}]
    })

    expect(findDroppedVendorKeys(manifest, 'brave')).toEqual([
      {
        path: 'chrome:key',
        familyPath: 'chromium:key',
        vendor: 'chrome',
        appliedBefore: true
      },
      {
        path: 'background.edge:service_worker',
        familyPath: 'background.chromium:service_worker',
        vendor: 'edge',
        appliedBefore: true
      },
      {
        path: 'content_scripts.0.chrome:js',
        familyPath: 'content_scripts.0.chromium:js',
        vendor: 'chrome',
        appliedBefore: true
      }
    ])
  })

  it('reports nothing for the named vendor or for gecko targets', () => {
    const manifest = asManifest({'chrome:key': 'k'})
    expect(findDroppedVendorKeys(manifest, 'chrome')).toEqual([])
    expect(findDroppedVendorKeys(manifest, 'firefox')).toEqual([])
  })

  it('marks a key the old family rule would have overridden', () => {
    // On edge, edge: always won over chrome:, and a later chromium: won the tie.
    const shadowed = asManifest({
      'chrome:action': {default_title: 'Chrome'},
      'edge:action': {default_title: 'Edge'},
      'chrome:key': 'k',
      'chromium:key': 'family-key'
    })
    expect(
      findDroppedVendorKeys(shadowed, 'edge').map((d) => [
        d.path,
        d.appliedBefore
      ])
    ).toEqual([
      ['chrome:action', false],
      ['chrome:key', false]
    ])

    // A chromium: or plain sibling is a deliberate per-browser value, so the
    // vendor key next to it is dropped by the documented rule, not silently.
    const vendorLast = asManifest({
      'chromium:key': 'family-key',
      'chrome:key': 'k'
    })
    expect(findDroppedVendorKeys(vendorLast, 'edge')[0].appliedBefore).toBe(
      false
    )

    const perBrowser = asManifest({
      'chromium:description': 'For Chrome',
      'edge:description': 'For Edge',
      'firefox:description': 'For Firefox'
    })
    expect(findDroppedVendorKeys(perBrowser, 'chrome')[0].appliedBefore).toBe(
      false
    )

    const plainSibling = asManifest({
      description: 'Plain',
      'edge:description': 'Edge'
    })
    expect(findDroppedVendorKeys(plainSibling, 'chrome')[0].appliedBefore).toBe(
      false
    )

    const alone = asManifest({'edge:description': 'Edge only'})
    expect(findDroppedVendorKeys(alone, 'chrome')[0].appliedBefore).toBe(true)
  })

  it('does not walk into a subtree the resolver drops', () => {
    const manifest = {'firefox:background': {'chrome:scripts': ['a.js']}}
    expect(findDroppedVendorKeys(manifest, 'edge')).toEqual([])
  })
})
