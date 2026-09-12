import {describe, expect, it} from 'vitest'
import {filterKeysForThisBrowser} from '../../../lib/manifest-utils'

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
    // Neither chromium: nor chrome: is the specific prefix on an edge build.
    // The manifest-fields package resolves entries with the same rule, so
    // this pins the shared outcome: change both or entries and consumers split.
    const chromeLast = {
      'chromium:action': {default_title: 'Chromium'},
      'chrome:action': {default_title: 'Chrome'}
    } as any
    expect(
      (filterKeysForThisBrowser(chromeLast, 'edge') as any).action
    ).toEqual({default_title: 'Chrome'})

    const chromiumLast = {
      'chrome:action': {default_title: 'Chrome'},
      'chromium:action': {default_title: 'Chromium'}
    } as any
    expect(
      (filterKeysForThisBrowser(chromiumLast, 'edge') as any).action
    ).toEqual({default_title: 'Chromium'})

    // The specific prefix still beats every family sibling regardless of order.
    const specificFirst = {
      'edge:action': {default_title: 'Edge'},
      'chrome:action': {default_title: 'Chrome'}
    } as any
    expect(
      (filterKeysForThisBrowser(specificFirst, 'edge') as any).action
    ).toEqual({default_title: 'Edge'})
  })
})
