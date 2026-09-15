import {describe, expect, it} from 'vitest'
import {
  filterKeysForThisBrowser,
  findDroppedVendorKeys
} from '../../../lib/manifest-utils'

describe('filterKeysForThisBrowser', () => {
  it('keeps plain keys and applies chromium-prefixed overrides', () => {
    const manifest = {
      name: 'x',
      version: '1.0.0',
      'chromium:action': {default_title: 'Chromium'},
      'firefox:action': {default_title: 'Firefox'}
    } as any

    const patched = filterKeysForThisBrowser(manifest, 'chrome') as any
    expect(patched.name).toBe('x')
    expect(patched.version).toBe('1.0.0')
    expect(patched.action).toEqual({default_title: 'Chromium'})
    expect((patched as any)['firefox:action']).toBeUndefined()
  })

  it('applies gecko-prefixed overrides for firefox', () => {
    const manifest = {
      name: 'x',
      'gecko:action': {default_title: 'Gecko'},
      'chrome:action': {default_title: 'Chrome'}
    } as any

    const patched = filterKeysForThisBrowser(manifest, 'firefox') as any
    expect(patched.action).toEqual({default_title: 'Gecko'})
    expect((patched as any)['chrome:action']).toBeUndefined()
  })

  it('resolves chromium-prefixed keys for safari (MV3 chromium-shaped bundle)', () => {
    const manifest = {
      name: 'x',
      'chromium:manifest_version': 3,
      'firefox:manifest_version': 2,
      'chromium:action': {default_title: 'Chromium'},
      'firefox:action': {default_title: 'Firefox'}
    } as any

    const patched = filterKeysForThisBrowser(manifest, 'safari') as any
    expect(patched.manifest_version).toBe(3)
    expect(patched.action).toEqual({default_title: 'Chromium'})
    expect((patched as any)['firefox:action']).toBeUndefined()
  })

  it('keeps source order between sibling family prefixes, the later key wins', () => {
    // Neither gecko: nor firefox: is the specific prefix on a waterfox build.
    const firefoxLast = {
      'gecko:action': {default_title: 'Gecko'},
      'firefox:action': {default_title: 'Firefox'}
    } as any
    expect(
      (filterKeysForThisBrowser(firefoxLast, 'waterfox') as any).action
    ).toEqual({default_title: 'Firefox'})

    const geckoLast = {
      'firefox:action': {default_title: 'Firefox'},
      'gecko:action': {default_title: 'Gecko'}
    } as any
    expect(
      (filterKeysForThisBrowser(geckoLast, 'waterfox') as any).action
    ).toEqual({default_title: 'Gecko'})
  })

  describe('vendor-exact chrome: and edge:', () => {
    const manifest = {
      name: 'x',
      'chrome:key': 'store-key',
      'chromium:action': {default_title: 'Chromium'},
      'edge:action': {default_title: 'Edge'}
    } as any

    it('applies chrome: only to a chrome build', () => {
      expect((filterKeysForThisBrowser(manifest, 'chrome') as any).key).toBe(
        'store-key'
      )
      for (const browser of [
        'edge',
        'chromium',
        'chromium-based',
        'brave',
        'safari'
      ]) {
        expect(
          filterKeysForThisBrowser(manifest, browser as any)
        ).not.toHaveProperty('key')
      }
    })

    it('applies edge: only to an edge build, over the chromium: family key', () => {
      expect(
        (filterKeysForThisBrowser(manifest, 'edge') as any).action
      ).toEqual({default_title: 'Edge'})
      for (const browser of ['chrome', 'chromium', 'brave', 'safari']) {
        expect(
          (filterKeysForThisBrowser(manifest, browser as any) as any).action
        ).toEqual({default_title: 'Chromium'})
      }
    })

    it('ranks the vendor key over the family key regardless of order', () => {
      const vendorFirst = {
        'chrome:action': {default_title: 'Chrome'},
        'chromium:action': {default_title: 'Chromium'},
        action: {default_title: 'Plain'}
      } as any
      expect(
        (filterKeysForThisBrowser(vendorFirst, 'chrome') as any).action
      ).toEqual({default_title: 'Chrome'})
      expect(
        (filterKeysForThisBrowser(vendorFirst, 'edge') as any).action
      ).toEqual({default_title: 'Chromium'})
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
    const manifest = {
      'chrome:key': 'store-key',
      background: {'edge:service_worker': 'sw.js'},
      content_scripts: [{'chrome:js': ['a.js']}]
    } as any

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
    const manifest = {'chrome:key': 'k'} as any
    expect(findDroppedVendorKeys(manifest, 'chrome')).toEqual([])
    expect(findDroppedVendorKeys(manifest, 'firefox')).toEqual([])
  })

  it('marks a key the old family rule would have overridden', () => {
    // On edge, edge: always won over chrome:, and a later chromium: won the tie.
    const shadowed = {
      'chrome:action': {default_title: 'Chrome'},
      'edge:action': {default_title: 'Edge'},
      'chrome:key': 'k',
      'chromium:key': 'family-key'
    } as any
    expect(
      findDroppedVendorKeys(shadowed, 'edge').map((d) => [
        d.path,
        d.appliedBefore
      ])
    ).toEqual([
      ['chrome:action', false],
      ['chrome:key', false]
    ])

    const vendorLast = {'chromium:key': 'family-key', 'chrome:key': 'k'} as any
    expect(findDroppedVendorKeys(vendorLast, 'edge')[0].appliedBefore).toBe(
      true
    )
  })

  it('does not walk into a subtree the resolver drops', () => {
    const manifest = {'firefox:background': {'chrome:scripts': ['a.js']}}
    expect(findDroppedVendorKeys(manifest as any, 'edge')).toEqual([])
  })
})
