import {describe, expect, it} from 'vitest'
import * as messages from '../../messages'
import {
  dropGeckoUnsupportedKeys,
  GECKO_UNSUPPORTED_PERMISSIONS
} from '../filter-keys-gecko'
import {buildCanonicalManifestWithOverrides} from '../manifest'

const strip = (value: string) =>
  // eslint-disable-next-line no-control-regex
  value.replace(/\u001b\[[0-9;]*m/g, '')

const source = {
  name: 'x',
  version: '1.0.0',
  manifest_version: 3,
  permissions: ['sidePanel', 'debugger', 'storage', 'scripting'],
  optional_permissions: ['offscreen', 'userScripts'],
  incognito: 'split'
} as any

describe('dropGeckoUnsupportedKeys', () => {
  it('drops the permission strings Firefox rejects, from both lists', () => {
    const {manifest, dropped} = dropGeckoUnsupportedKeys(source, 'firefox')

    expect((manifest as any).permissions).toEqual(['storage', 'scripting'])
    expect((manifest as any).optional_permissions).toEqual(['userScripts'])
    expect(dropped).toEqual([
      {
        path: 'permissions.sidePanel',
        reason: 'Firefox has no sidePanel permission'
      },
      {
        path: 'permissions.debugger',
        reason: 'Firefox has no debugger permission'
      },
      {
        path: 'optional_permissions.offscreen',
        reason: 'Firefox has no offscreen permission'
      }
    ])
  })

  it('removes a list the drop empties', () => {
    const {manifest} = dropGeckoUnsupportedKeys(
      {...source, permissions: ['sidePanel']},
      'firefox'
    )

    expect(manifest).not.toHaveProperty('permissions')
  })

  it('keeps incognito split and names the value Firefox runs with', () => {
    const {manifest, reinterpreted} = dropGeckoUnsupportedKeys(
      source,
      'firefox'
    )

    expect((manifest as any).incognito).toBe('split')
    expect(reinterpreted).toEqual([
      {path: 'incognito', declared: 'split', effective: 'not_allowed'}
    ])
  })

  it('leaves the values Firefox has a mode for alone', () => {
    for (const incognito of ['spanning', 'not_allowed']) {
      expect(
        dropGeckoUnsupportedKeys({...source, incognito}, 'firefox')
          .reinterpreted
      ).toEqual([])
    }
  })

  it('applies to every gecko target and to no other engine', () => {
    for (const browser of ['gecko-based', 'firefox-based', 'zen']) {
      expect(
        dropGeckoUnsupportedKeys(source, browser as any).dropped
      ).toHaveLength(3)
    }

    for (const browser of ['chrome', 'edge', 'safari']) {
      const result = dropGeckoUnsupportedKeys(source, browser as any)

      expect(result.manifest).toBe(source)
      expect(result.dropped).toEqual([])
      expect(result.reinterpreted).toEqual([])
    }
  })

  it('never lists a permission Firefox honors in either list', () => {
    // Read from getManifest() on a live Firefox that declared every name.
    const honored = [
      'activeTab',
      'alarms',
      'bookmarks',
      'browsingData',
      'clipboardRead',
      'clipboardWrite',
      'contextMenus',
      'cookies',
      'declarativeNetRequest',
      'declarativeNetRequestFeedback',
      'declarativeNetRequestWithHostAccess',
      'downloads',
      'geolocation',
      'history',
      'identity',
      'idle',
      'management',
      'nativeMessaging',
      'notifications',
      'privacy',
      'proxy',
      'scripting',
      'search',
      'sessions',
      'storage',
      'tabGroups',
      'tabs',
      'topSites',
      'unlimitedStorage',
      'userScripts',
      'webNavigation',
      'webRequest',
      'webRequestAuthProvider',
      'webRequestBlocking'
    ]

    expect(
      honored.filter((name) => GECKO_UNSUPPORTED_PERMISSIONS.has(name))
    ).toEqual([])
  })
})

describe('buildCanonicalManifestWithOverrides on a firefox build', () => {
  it('ships without the rejected permissions and with incognito as declared', () => {
    const result = buildCanonicalManifestWithOverrides(
      '/p/manifest.json',
      source,
      'firefox'
    ).manifest as any

    expect(result.permissions).toEqual(['storage', 'scripting'])
    expect(result.optional_permissions).toEqual(['userScripts'])
    expect(result.incognito).toBe('split')
  })

  it('keeps every permission on a chrome build', () => {
    const result = buildCanonicalManifestWithOverrides(
      '/p/manifest.json',
      source,
      'chrome'
    ).manifest as any

    expect(result.permissions).toEqual(source.permissions)
    expect(result.optional_permissions).toEqual(source.optional_permissions)
  })
})

describe('the firefox notices', () => {
  it('names the dropped keys in the block the safari build uses', () => {
    const lines = strip(
      messages.geckoUnsupportedKeysDropped('firefox', [
        {
          path: 'permissions.sidePanel',
          reason: 'Firefox has no sidePanel permission'
        },
        {
          path: 'permissions.debugger',
          reason: 'Firefox has no debugger permission'
        }
      ])
    ).split('\n')

    expect(lines[0]).toContain(
      'Firefox has no support for 2 manifest keys this project declares, so the firefox build dropped them:'
    )

    expect(lines[1]).toBe(
      '│  permissions.sidePanel Firefox has no sidePanel permission'
    )

    expect(lines[3]).toContain(
      'These 2 keys are inert on Firefox, so the built extension lost nothing it could have run. Declare a Firefox-only replacement with the firefox: prefix if you have one.'
    )

    expect(lines).toHaveLength(4)
  })

  it('names one dropped key in one sentence', () => {
    const text = strip(
      messages.geckoUnsupportedKeysDropped('firefox', [
        {
          path: 'permissions.debugger',
          reason: 'Firefox has no debugger permission'
        }
      ])
    )

    expect(text).not.toContain('\n')
    expect(text).toContain(
      'Firefox has no support for permissions.debugger (Firefox has no debugger permission), so the firefox build dropped it, and nothing the extension could have run was lost.'
    )
  })

  it('says what incognito split becomes and that the value was kept', () => {
    const text = strip(messages.geckoIncognitoSplitNotAllowed('firefox'))

    expect(text).toContain(
      'it reads incognito: "split" as "not_allowed" and the firefox build never runs in private windows'
    )

    expect(text).toContain('The build kept the value as declared.')
    expect(text).toContain('firefox:incognito')
  })
})
