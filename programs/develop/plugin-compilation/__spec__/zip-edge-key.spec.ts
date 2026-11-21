import {describe, expect, it} from 'vitest'
import {buildCanonicalManifestWithOverrides} from '../../plugin-web-extension/feature-manifest/manifest-lib/manifest'
import type {Manifest} from '../../types'
import {dropEdgeStoreKey} from '../zip-edge-key'

describe('dropEdgeStoreKey', () => {
  const withKey = {
    name: 'x',
    manifest_version: 3,
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A'
  }

  it('drops the key on an edge build, since Edge Add-ons rejects the field', () => {
    const out = dropEdgeStoreKey(withKey, 'edge')
    expect(out.dropped).toBe(true)
    expect(out.manifest).not.toHaveProperty('key')
  })

  it('keeps every other field while dropping the key', () => {
    const out = dropEdgeStoreKey(withKey, 'edge')
    expect(out.manifest).toMatchObject({name: 'x', manifest_version: 3})
  })

  it('leaves the key alone on every other target', () => {
    for (const browser of [
      'chrome',
      'chromium',
      'chromium-based',
      'brave',
      'firefox',
      'safari'
    ]) {
      const out = dropEdgeStoreKey(
        withKey,
        browser as Parameters<typeof dropEdgeStoreKey>[1]
      )
      expect(out.dropped).toBe(false)
      expect(out.manifest).toHaveProperty('key')
    }
  })

  it('reports nothing when the manifest carries no key', () => {
    const out = dropEdgeStoreKey({name: 'x'}, 'edge')
    expect(out.dropped).toBe(false)
  })

  // The reported shape: a prefix the user wrote on purpose resolves to a real
  // `key`, which is exactly the manifest Partner Center refuses.
  it('catches the key that edge: and chromium: prefixes resolve into', () => {
    for (const prefixed of ['edge:key', 'chromium:key']) {
      const resolved = buildCanonicalManifestWithOverrides(
        '/tmp/manifest.json',
        {name: 'x', manifest_version: 3, [prefixed]: 'store-key'} as Manifest,
        'edge'
      ).manifest as Record<string, unknown>
      expect(resolved.key).toBe('store-key')
      expect(dropEdgeStoreKey(resolved, 'edge').manifest).not.toHaveProperty(
        'key'
      )
    }
  })

  it('does not disturb a chrome build, where the key is legitimate', () => {
    const resolved = buildCanonicalManifestWithOverrides(
      '/tmp/manifest.json',
      {name: 'x', manifest_version: 3, 'chrome:key': 'store-key'} as Manifest,
      'chrome'
    ).manifest as Record<string, unknown>
    expect(dropEdgeStoreKey(resolved, 'chrome').manifest.key).toBe('store-key')
  })
})
