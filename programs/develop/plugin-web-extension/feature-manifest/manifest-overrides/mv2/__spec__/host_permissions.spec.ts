import {describe, expect, it} from 'vitest'
import {dropMv2HostKeys, hostPermissions} from '../host_permissions'

describe('mv2 host_permissions override', () => {
  it('folds host_permissions into permissions, deduped and in order', () => {
    const result = hostPermissions({
      manifest_version: 2,
      permissions: ['storage', '<all_urls>'],
      host_permissions: ['<all_urls>', 'https://api.example.com/*']
    } as any) as any

    expect(result.permissions).toEqual([
      'storage',
      '<all_urls>',
      'https://api.example.com/*'
    ])

    expect(result.optional_permissions).toBeUndefined()
  })

  it('folds optional_host_permissions into optional_permissions', () => {
    const result = hostPermissions({
      manifest_version: 2,
      optional_permissions: ['tabs'],
      optional_host_permissions: ['https://opt.example.com/*']
    } as any) as any

    expect(result.optional_permissions).toEqual([
      'tabs',
      'https://opt.example.com/*'
    ])

    expect(result.permissions).toBeUndefined()
  })

  it('creates permissions when the manifest only declared hosts', () => {
    const result = hostPermissions({
      manifest_version: 2,
      host_permissions: ['https://a.example.com/*']
    } as any) as any

    expect(result.permissions).toEqual(['https://a.example.com/*'])
  })

  it('leaves MV3 alone', () => {
    expect(
      hostPermissions({
        manifest_version: 3,
        permissions: ['storage'],
        host_permissions: ['<all_urls>']
      } as any)
    ).toBeUndefined()
  })

  it('returns undefined for MV2 without host keys', () => {
    expect(
      hostPermissions({manifest_version: 2, permissions: ['storage']} as any)
    ).toBeUndefined()
  })
})

describe('dropMv2HostKeys', () => {
  it('removes both MV3 host keys from an MV2 manifest', () => {
    const result = dropMv2HostKeys({
      manifest_version: 2,
      permissions: ['storage', '<all_urls>'],
      host_permissions: ['<all_urls>'],
      optional_host_permissions: ['https://opt.example.com/*']
    })
    expect(result).toEqual({
      manifest_version: 2,
      permissions: ['storage', '<all_urls>']
    })
  })

  it('returns an MV3 manifest unchanged', () => {
    const manifest = {manifest_version: 3, host_permissions: ['<all_urls>']}
    expect(dropMv2HostKeys(manifest)).toBe(manifest)
  })
})
