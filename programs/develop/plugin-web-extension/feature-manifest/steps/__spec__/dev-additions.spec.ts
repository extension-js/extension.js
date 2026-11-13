import {describe, expect, it} from 'vitest'
import {
  devAdditionsOf,
  mergeDevAdditions,
  recordDevAdditions
} from '../../../../lib/dev-additions'
import {listDevManifestAdditions} from '../apply-dev-defaults-lib/dev-additions'

describe('listDevManifestAdditions', () => {
  it('names each permission, host and resource the dev manifest gained', () => {
    const additions = listDevManifestAdditions(
      {
        permissions: ['storage', 'debugger'],
        web_accessible_resources: [
          {resources: ['pages/demo.html'], matches: ['https://a.example/*']}
        ]
      },
      {
        permissions: ['scripting', 'tabs', 'storage', 'debugger'],
        host_permissions: ['<all_urls>'],
        web_accessible_resources: [
          {resources: ['pages/demo.html'], matches: ['https://a.example/*']},
          {
            resources: ['hot/*', 'extension-js-control.json'],
            matches: ['<all_urls>']
          }
        ]
      }
    )

    expect(additions.map((entry) => [entry.kind, entry.value])).toEqual([
      ['permission', 'scripting'],
      ['permission', 'tabs'],
      ['host_permission', '<all_urls>'],
      ['web_accessible_resource', 'hot/*'],
      ['web_accessible_resource', 'extension-js-control.json']
    ])

    expect(additions.every((entry) => entry.reason.length > 0)).toBe(true)
    expect(additions[3].matches).toEqual(['<all_urls>'])
  })

  it('reports a resource the source lists when dev widens who can read it', () => {
    const additions = listDevManifestAdditions(
      {
        web_accessible_resources: [
          {resources: ['hot/*'], matches: ['https://a.example/*']}
        ]
      },
      {
        web_accessible_resources: [
          {resources: ['hot/*'], matches: ['https://a.example/*']},
          {resources: ['hot/*'], matches: ['<all_urls>']}
        ]
      }
    )

    expect(additions).toEqual([
      expect.objectContaining({
        kind: 'web_accessible_resource',
        value: 'hot/*',
        matches: ['<all_urls>']
      })
    ])
  })

  it('tells a Manifest V2 host from a permission and leaves matches out', () => {
    const additions = listDevManifestAdditions(
      {manifest_version: 2, permissions: ['storage']} as never,
      {
        permissions: ['tabs', 'https://a.example/*', 'storage'],
        web_accessible_resources: ['hot/*']
      }
    )

    expect(additions.map((entry) => [entry.kind, entry.value])).toEqual([
      ['permission', 'tabs'],
      ['host_permission', 'https://a.example/*'],
      ['web_accessible_resource', 'hot/*']
    ])

    expect('matches' in additions[2]).toBe(false)
  })

  it('answers an empty list when dev added nothing', () => {
    const manifest = {
      permissions: ['scripting', 'tabs', 'storage'],
      host_permissions: ['<all_urls>']
    }

    expect(listDevManifestAdditions(manifest, manifest)).toEqual([])
  })
})

describe('the dev additions a compilation recorded', () => {
  it('tells a compilation that patched nothing from one that added nothing', () => {
    const patched = {}
    recordDevAdditions(patched, [])

    expect(devAdditionsOf(patched)).toEqual([])
    expect(devAdditionsOf({})).toBeUndefined()
    expect(devAdditionsOf(undefined)).toBeUndefined()
  })

  it('replaces the manifest entries and keeps the flag the launcher stamped', () => {
    const flag = {
      kind: 'browser_flag' as const,
      value: '--silent-debugger-extension-api',
      reason: 'hides the bar',
      applied: true
    }
    const stale = {kind: 'permission' as const, value: 'tabs', reason: 'old'}
    const fresh = {
      kind: 'permission' as const,
      value: 'scripting',
      reason: 'new'
    }

    expect(mergeDevAdditions([fresh], [stale, flag])).toEqual([fresh, flag])
    expect(mergeDevAdditions(undefined, [stale, flag])).toEqual([stale, flag])
    expect(mergeDevAdditions(undefined, undefined)).toBeUndefined()
    expect(mergeDevAdditions([], 'not a list')).toEqual([])
  })
})
