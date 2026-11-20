import {describe, expect, it} from 'vitest'
import {
  appendDevAdditions,
  devAdditionsOf,
  mergeDevAdditions
} from '../../../../lib/dev-additions'
import {listDevManifestAdditions} from '../apply-dev-defaults-lib/dev-additions'

describe('listDevManifestAdditions', () => {
  const changes = (
    source: Parameters<typeof listDevManifestAdditions>[0],
    dev: Parameters<typeof listDevManifestAdditions>[1]
  ) =>
    listDevManifestAdditions(source, dev)
      .filter((entry) => entry.kind === 'manifest_change')
      .map((entry) => entry.value)

  it('names eval when dev adds it to the pages policy', () => {
    const dev = "script-src 'self' 'unsafe-eval' blob: filesystem:; "

    expect(changes({}, {content_security_policy: dev})).toEqual([
      "content_security_policy 'unsafe-eval'"
    ])

    expect(
      changes(
        {content_security_policy: "script-src 'self' 'unsafe-eval'"},
        {content_security_policy: dev}
      )
    ).toEqual([])

    // The WebAssembly keyword is another source, and dev does not add eval
    // to a Manifest V3 policy.
    expect(
      changes(
        {},
        {
          content_security_policy: {
            extension_pages: "script-src 'self' 'wasm-unsafe-eval'"
          }
        }
      )
    ).toEqual([])
  })

  it('names the connect list dev opens, and not one the author opened', () => {
    const matches = ['https://a.example/*']

    expect(
      changes(
        {externally_connectable: {matches}},
        {externally_connectable: {matches, ids: ['*']}}
      )
    ).toEqual(['externally_connectable.ids *'])

    expect(
      changes(
        {externally_connectable: {matches, ids: ['*']}},
        {externally_connectable: {matches, ids: ['*']}}
      )
    ).toEqual([])
  })

  it('names an event page dev keeps alive, and not the default it restates', () => {
    const scripts = ['background/scripts.js']

    expect(
      changes(
        {background: {scripts, persistent: false}},
        {background: {scripts, persistent: true}}
      )
    ).toEqual(['background.persistent true'])

    expect(
      changes(
        {background: {scripts}},
        {background: {scripts, persistent: true}}
      )
    ).toEqual([])
  })

  it('names the background dev adds in the shape it took', () => {
    expect(
      changes(
        {},
        {background: {service_worker: 'background/service_worker.js'}}
      )
    ).toEqual(['background.service_worker background/service_worker.js'])

    expect(
      changes(
        {background: {}},
        {background: {scripts: ['background/script.js'], persistent: true}}
      )
    ).toEqual(['background.scripts background/script.js'])
  })

  it('gives every change a reason', () => {
    const additions = listDevManifestAdditions(
      {
        background: {scripts: ['a.js'], persistent: false},
        externally_connectable: {matches: ['https://a.example/*']}
      },
      {
        content_security_policy: "script-src 'self' 'unsafe-eval'",
        background: {scripts: ['a.js'], persistent: true},
        externally_connectable: {matches: ['https://a.example/*'], ids: ['*']}
      }
    )

    expect(additions).toHaveLength(3)
    expect(additions.every((entry) => entry.reason.length > 0)).toBe(true)
  })

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
    appendDevAdditions(patched, [])

    expect(devAdditionsOf(patched)).toEqual([])
    expect(devAdditionsOf({})).toBeUndefined()
    expect(devAdditionsOf(undefined)).toBeUndefined()
  })

  it('keeps what two steps of one compile added and says a repeat once', () => {
    const compilation = {}
    const stubs = {
      kind: 'manifest_change' as const,
      value: 'content_scripts dev stubs',
      reason: 'first step'
    }
    const tabs = {kind: 'permission' as const, value: 'tabs', reason: 'second'}

    appendDevAdditions(compilation, [stubs])
    appendDevAdditions(compilation, [tabs, {...stubs, reason: 'again'}])

    expect(devAdditionsOf(compilation)).toEqual([stubs, tabs])
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
