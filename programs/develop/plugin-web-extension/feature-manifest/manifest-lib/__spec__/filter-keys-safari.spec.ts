import {describe, expect, it} from 'vitest'
import {dropWebkitUnsupportedKeys} from '../filter-keys-safari'
import {buildCanonicalManifest, filterKeysForThisBrowser} from '../manifest'

describe('filterKeysForThisBrowser (manifest-lib), Safari', () => {
  const manifest = {
    name: 'x',
    'chromium:manifest_version': 3,
    'firefox:manifest_version': 2,
    'chromium:action': {default_title: 'Chromium'},
    'firefox:action': {default_title: 'Firefox'}
  } as any

  it('resolves chromium manifest_version and keys for safari', () => {
    const patched = filterKeysForThisBrowser(manifest, 'safari') as any
    expect(patched.manifest_version).toBe(3)
    expect(patched.action).toEqual({default_title: 'Chromium'})
  })

  it('resolves chromium keys for webkit-based targets', () => {
    const patched = filterKeysForThisBrowser(
      manifest,
      'webkit-based' as any
    ) as any
    expect(patched.manifest_version).toBe(3)
  })

  it('still resolves gecko keys for firefox (no chromium bleed-through)', () => {
    const patched = filterKeysForThisBrowser(manifest, 'firefox') as any
    expect(patched.manifest_version).toBe(2)
    expect(patched.action).toEqual({default_title: 'Firefox'})
  })

  describe('safari:/webkit: prefixes', () => {
    const prefixed = {
      name: 'x',
      'chromium:action': {default_title: 'Chromium'},
      'safari:action': {default_title: 'Safari'},
      permissions: ['storage'],
      'webkit:permissions': ['storage', 'nativeMessaging']
    } as any

    it('safari: wins over chromium-family keys for --browser=safari', () => {
      const patched = filterKeysForThisBrowser(prefixed, 'safari') as any
      expect(patched.action).toEqual({default_title: 'Safari'})
      expect(patched.permissions).toEqual(['storage', 'nativeMessaging'])
    })

    it('safari:/webkit: resolve identically for --browser=webkit-based', () => {
      const patched = filterKeysForThisBrowser(
        prefixed,
        'webkit-based' as any
      ) as any
      expect(patched.action).toEqual({default_title: 'Safari'})
      expect(patched.permissions).toEqual(['storage', 'nativeMessaging'])
    })

    it('safari:/webkit: resolve identically for any webkit-flavored fork name', () => {
      const patched = filterKeysForThisBrowser(
        prefixed,
        'acme-webkit' as any
      ) as any
      expect(patched.action).toEqual({default_title: 'Safari'})
      expect(patched.permissions).toEqual(['storage', 'nativeMessaging'])
      // Still inherits chromium-family keys when no safari/webkit override.
      const chromiumOnly = {
        name: 'x',
        'chromium:manifest_version': 3,
        'firefox:manifest_version': 2
      } as any
      const inherited = filterKeysForThisBrowser(
        chromiumOnly,
        'acme-webkit' as any
      ) as any
      expect(inherited.manifest_version).toBe(3)
    })

    it('safari: wins regardless of key order in the source manifest', () => {
      const reversed = {
        'safari:action': {default_title: 'Safari'},
        'chromium:action': {default_title: 'Chromium'},
        name: 'x'
      } as any
      const patched = filterKeysForThisBrowser(reversed, 'safari') as any
      expect(patched.action).toEqual({default_title: 'Safari'})
    })

    it('safari: keys are dropped for chromium and firefox targets', () => {
      const chrome = filterKeysForThisBrowser(prefixed, 'chrome') as any
      expect(chrome.action).toEqual({default_title: 'Chromium'})
      expect(chrome.permissions).toEqual(['storage'])

      const firefox = filterKeysForThisBrowser(prefixed, 'firefox') as any
      expect(firefox.action).toBeUndefined()
      expect(firefox.permissions).toEqual(['storage'])
    })
  })
})

// Inheriting chromium keys is the right default, but Safari has no code for
// some of them. The converter names each one it rejects, and these cases pin
// the ones MDN browser-compat-data agrees are unsupported or inert.
describe('dropWebkitUnsupportedKeys', () => {
  const drop = (manifest: any, browser = 'safari') =>
    dropWebkitUnsupportedKeys(manifest, browser as any)

  it('drops side_panel, the key behind a dead Safari toolbar button', () => {
    const {manifest, dropped} = drop({
      name: 'x',
      side_panel: {default_path: 'sidebar/index.html'}
    })
    expect(manifest).not.toHaveProperty('side_panel')
    expect(dropped).toEqual([
      {path: 'side_panel', reason: 'Safari has no side panel surface'}
    ])
  })

  it('drops the sidePanel permission that rides with it', () => {
    const {manifest, dropped} = drop({
      name: 'x',
      permissions: ['sidePanel', 'storage']
    })
    expect(manifest.permissions).toEqual(['storage'])
    expect(dropped).toEqual([
      {path: 'permissions.sidePanel', reason: 'Safari has no sidePanel API'}
    ])
  })

  it('removes the permissions key entirely once nothing supported is left', () => {
    const {manifest} = drop({name: 'x', permissions: ['sidePanel']})
    expect(manifest).not.toHaveProperty('permissions')
  })

  it('drops sandbox, so a page that cannot run is not advertised', () => {
    const {manifest, dropped} = drop({
      name: 'x',
      sandbox: {pages: ['sandbox/page-0.html']}
    })
    expect(manifest).not.toHaveProperty('sandbox')
    expect(dropped[0].path).toBe('sandbox')
  })

  it('drops user_scripts, omnibox and incognito', () => {
    const {manifest, dropped} = drop({
      name: 'x',
      user_scripts: {},
      omnibox: {keyword: 'go'},
      incognito: 'split'
    })
    expect(manifest).not.toHaveProperty('user_scripts')
    expect(manifest).not.toHaveProperty('omnibox')
    expect(manifest).not.toHaveProperty('incognito')
    expect(dropped.map((entry) => entry.path).sort()).toEqual([
      'incognito',
      'omnibox',
      'user_scripts'
    ])
  })

  it('filters optional_permissions with the same list', () => {
    const {manifest, dropped} = drop({
      name: 'x',
      optional_permissions: ['management', 'tabs']
    })
    expect(manifest.optional_permissions).toEqual(['tabs'])
    expect(dropped[0].path).toBe('optional_permissions.management')
  })

  it('keeps every permission Safari actually implements', () => {
    const supported = [
      'storage',
      'tabs',
      'scripting',
      'activeTab',
      'alarms',
      'cookies',
      'contextMenus',
      'nativeMessaging',
      'webNavigation',
      'webRequest',
      'unlimitedStorage',
      'declarativeNetRequest'
    ]
    const {manifest, dropped} = drop({name: 'x', permissions: [...supported]})
    expect(manifest.permissions).toEqual(supported)
    expect(dropped).toEqual([])
  })

  it('keeps top-level keys Safari implements, including background', () => {
    // `background` is rejected as a PERMISSION but is a supported top-level
    // key, so the drop has to read location and not just the name.
    const source = {
      name: 'x',
      background: {service_worker: 'background.js'},
      action: {default_title: 't'},
      storage: {managed_schema: 'schema.json'},
      devtools_page: 'devtools.html',
      chrome_url_overrides: {newtab: 'newtab.html'},
      declarative_net_request: {rule_resources: []},
      externally_connectable: {matches: []},
      commands: {},
      web_accessible_resources: [],
      host_permissions: ['<all_urls>'],
      permissions: ['background']
    }
    const {manifest, dropped} = drop(source)
    expect(manifest.background).toEqual({service_worker: 'background.js'})
    expect(manifest).not.toHaveProperty('permissions')
    expect(dropped).toEqual([
      {path: 'permissions.background', reason: 'Safari has no background API'}
    ])
  })

  it('drops options_ui.open_in_tab but keeps the options page itself', () => {
    const {manifest, dropped} = drop({
      name: 'x',
      options_ui: {page: 'options/index.html', open_in_tab: false}
    })
    expect(manifest.options_ui).toEqual({page: 'options/index.html'})
    expect(dropped).toEqual([
      {
        path: 'options_ui.open_in_tab',
        reason: 'Safari always opens the options page in a tab'
      }
    ])
  })

  // MDN records content_scripts[].world as supported from Safari 18, so the
  // converter warning is stale. Dropping it would silently demote a MAIN
  // world script on a Safari that can honor it.
  it('keeps content_scripts[].world and never loses the entry', () => {
    const {manifest, dropped} = drop({
      name: 'x',
      content_scripts: [
        {matches: ['<all_urls>'], js: ['isolated.js']},
        {matches: ['<all_urls>'], js: ['main.js'], world: 'MAIN'}
      ]
    })
    expect(manifest.content_scripts).toHaveLength(2)
    expect(manifest.content_scripts[1]).toEqual({
      matches: ['<all_urls>'],
      js: ['main.js'],
      world: 'MAIN'
    })

    expect(dropped).toEqual([])
  })

  it('is a no-op for chromium and gecko targets', () => {
    const source = {
      name: 'x',
      side_panel: {default_path: 'p.html'},
      permissions: ['sidePanel']
    }

    for (const browser of ['chrome', 'edge', 'firefox']) {
      const {manifest, dropped} = drop({...source}, browser)
      expect(manifest.side_panel).toEqual({default_path: 'p.html'})
      expect(manifest.permissions).toEqual(['sidePanel'])
      expect(dropped).toEqual([])
    }
  })

  it('applies to every webkit-flavored target name', () => {
    for (const browser of ['safari', 'webkit-based', 'acme-webkit']) {
      const {manifest, dropped} = drop(
        {name: 'x', side_panel: {default_path: 'p.html'}},
        browser
      )
      expect(manifest).not.toHaveProperty('side_panel')
      expect(dropped).toHaveLength(1)
    }
  })

  it('leaves the source manifest untouched', () => {
    const source = {
      name: 'x',
      side_panel: {default_path: 'p.html'},
      permissions: ['sidePanel', 'storage'],
      options_ui: {page: 'o.html', open_in_tab: true}
    }
    drop(source)
    expect(source.side_panel).toEqual({default_path: 'p.html'})
    expect(source.permissions).toEqual(['sidePanel', 'storage'])
    expect(source.options_ui).toEqual({page: 'o.html', open_in_tab: true})
  })
})

// The overrides rewrite side_panel and sandbox paths, so the drop has to run
// after them or the key comes back on the way out.
describe('safari drops survive the manifest overrides', () => {
  const source = {
    name: 'x',
    'chromium:manifest_version': 3,
    'chromium:side_panel': {default_path: 'sidebar/index.html'},
    'chromium:permissions': ['sidePanel'],
    sandbox: {pages: ['sandbox/index.html']}
  } as any

  it('emits no side_panel, sandbox or sidePanel for a safari build', () => {
    const result = buildCanonicalManifest(
      '/p/manifest.json',
      source,
      'safari'
    ) as any

    expect(result.manifest_version).toBe(3)
    expect(result).not.toHaveProperty('side_panel')
    expect(result).not.toHaveProperty('sandbox')
    expect(result).not.toHaveProperty('permissions')
  })

  it('still emits all three for a chrome build', () => {
    const result = buildCanonicalManifest(
      '/p/manifest.json',
      source,
      'chrome'
    ) as any

    expect(result.side_panel).toBeDefined()
    expect(result.sandbox).toBeDefined()
    expect(result.permissions).toEqual(['sidePanel'])
  })
})
