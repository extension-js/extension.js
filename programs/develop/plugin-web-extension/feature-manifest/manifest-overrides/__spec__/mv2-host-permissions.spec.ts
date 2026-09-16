import {describe, expect, it} from 'vitest'
import {buildCanonicalManifest} from '../../manifest-lib/manifest'
import {getManifestOverrides} from '../../manifest-overrides'

// Firefox MV2 rejects host_permissions. The override folds the patterns into
// permissions and both writers drop the MV3 keys, MV3 output stays as written.
const source = {
  name: 'hosts',
  version: '1.0.0',
  'chromium:manifest_version': 3,
  'firefox:manifest_version': 2,
  permissions: ['storage', '<all_urls>'],
  host_permissions: ['<all_urls>', 'https://api.example.com/*'],
  optional_permissions: ['tabs'],
  optional_host_permissions: ['https://opt.example.com/*']
}

describe('MV2 host_permissions through getManifestOverrides', () => {
  it('folds the host lists into permissions and drops the MV3 keys', () => {
    const {
      'chromium:manifest_version': _mv3,
      'firefox:manifest_version': _mv2,
      ...rest
    } = source
    const result = JSON.parse(
      getManifestOverrides('/p/manifest.json', {
        ...rest,
        manifest_version: 2
      } as any)
    )

    expect(result.manifest_version).toBe(2)
    expect(result).not.toHaveProperty('host_permissions')
    expect(result).not.toHaveProperty('optional_host_permissions')
    expect(result.permissions).toEqual([
      'storage',
      '<all_urls>',
      'https://api.example.com/*'
    ])

    expect(result.optional_permissions).toEqual([
      'tabs',
      'https://opt.example.com/*'
    ])
  })

  it('keeps MV3 host keys and permissions as written', () => {
    const {
      'chromium:manifest_version': _mv3,
      'firefox:manifest_version': _mv2,
      ...rest
    } = source
    const result = JSON.parse(
      getManifestOverrides('/p/manifest.json', {
        ...rest,
        manifest_version: 3
      } as any)
    )

    expect(result.host_permissions).toEqual([
      '<all_urls>',
      'https://api.example.com/*'
    ])

    expect(result.optional_host_permissions).toEqual([
      'https://opt.example.com/*'
    ])

    expect(result.permissions).toEqual(['storage', '<all_urls>'])
    expect(result.optional_permissions).toEqual(['tabs'])
  })
})

describe('MV2 host_permissions through buildCanonicalManifest', () => {
  it('drops the keys for firefox once the prefixed manifest_version resolves to 2', () => {
    const result = buildCanonicalManifest(
      '/p/manifest.json',
      source as any,
      'firefox'
    ) as any

    expect(result.manifest_version).toBe(2)
    expect(result).not.toHaveProperty('host_permissions')
    expect(result).not.toHaveProperty('optional_host_permissions')
    expect(result.permissions).toEqual([
      'storage',
      '<all_urls>',
      'https://api.example.com/*'
    ])

    expect(result.optional_permissions).toEqual([
      'tabs',
      'https://opt.example.com/*'
    ])
  })

  it('keeps the keys for chrome where manifest_version resolves to 3', () => {
    const result = buildCanonicalManifest(
      '/p/manifest.json',
      source as any,
      'chrome'
    ) as any

    expect(result.manifest_version).toBe(3)
    expect(result.host_permissions).toEqual([
      '<all_urls>',
      'https://api.example.com/*'
    ])

    expect(result.permissions).toEqual(['storage', '<all_urls>'])
  })
})
