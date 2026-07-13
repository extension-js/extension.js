import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  diagnoseChromiumManifestRefusal,
  findChromiumLoadBlockers,
  findInvalidMatchPatterns,
  findLocaleLoadBlockers,
  findMissingManagedSchema,
  findUnloadableIconFiles
} from '../browsers-lib/manifest-refusal'

// Launch-time honesty for manifest shapes Chromium refuses to load AT ALL:
// the refusal surfaces as a native modal or as nothing (no console error, no
// CDP target), so dev must say why before the spawn. MV2 was already
// diagnosed; Firefox-style MV3 `background.scripts` without a service_worker
// is the second shape (MelonTranslate / spotify-hotkeys-firefox cluster).
describe('diagnoseChromiumManifestRefusal', () => {
  it('flags MV2', () => {
    expect(diagnoseChromiumManifestRefusal({manifest_version: 2})).toBe('mv2')
  })

  it('flags missing, MV1, and above-3 manifest_version as unsupported (wild: Custom-salesforce-inspector)', () => {
    // Chrome treats a missing manifest_version as MV1 and refuses with
    // "Cannot install extension because it uses an unsupported manifest
    // version" — same native-dialog wedge as MV2.
    expect(diagnoseChromiumManifestRefusal({name: 'x'})).toBe(
      'unsupported-manifest-version'
    )
    expect(diagnoseChromiumManifestRefusal({manifest_version: 1})).toBe(
      'unsupported-manifest-version'
    )
    expect(diagnoseChromiumManifestRefusal({manifest_version: 4})).toBe(
      'unsupported-manifest-version'
    )
  })

  it('flags MV3 with Firefox-style background.scripts and no service_worker', () => {
    expect(
      diagnoseChromiumManifestRefusal({
        manifest_version: 3,
        background: {scripts: ['background.js']}
      })
    ).toBe('mv3-background-scripts')
  })

  it('accepts MV3 with a service_worker (even alongside scripts)', () => {
    expect(
      diagnoseChromiumManifestRefusal({
        manifest_version: 3,
        background: {service_worker: 'sw.js'}
      })
    ).toBeNull()
    // Dual-declared manifests load on Chromium (it uses the worker) — the
    // scripts array is Firefox's half of a cross-browser manifest.
    expect(
      diagnoseChromiumManifestRefusal({
        manifest_version: 3,
        background: {service_worker: 'sw.js', scripts: ['background.js']}
      })
    ).toBeNull()
  })

  it('does NOT flag query strings or fragments (verified live: Chrome 150 installs them ENABLED)', () => {
    // `?` and `#` are literal path characters to Chrome's pattern parser —
    // verified live 2026-07-11 via CDP loadUnpacked AND --load-extension:
    // Ban-Checker's exact `.../gcpd/730?tab=majors` and `/page#section*`
    // both install ENABLED, and the store-published SN-Utils (323★) ships
    // `*://*/*?XML*` in exclude_matches. Flagging these warned "the whole
    // extension will not load" on extensions that load fine.
    const invalid = findInvalidMatchPatterns({
      manifest_version: 3,
      host_permissions: ['*://steamcommunity.com/*'],
      content_scripts: [
        {
          matches: [
            '*://steamcommunity.com/id/*/gcpd/730?tab=majors',
            'https://example.com/page#section'
          ],
          exclude_matches: ['*://*/*?XML*'],
          js: ['content.js']
        }
      ],
      web_accessible_resources: [
        {resources: ['a.js'], matches: ['https://ok.example/*']}
      ]
    })
    expect(invalid).toEqual([])
  })

  it('accepts valid patterns, <all_urls>, IPs, and explicit ports (wild: memux loads fine with localhost:3000)', () => {
    // Chromium's URLPattern ACCEPTS ports — verified live 2026-07-11: an
    // extension declaring http://localhost:3000/* and example.com:8888/*
    // installs ENABLED. Flagging them warned "the whole extension will not
    // load" on extensions that load fine.
    expect(
      findInvalidMatchPatterns({
        host_permissions: [
          '<all_urls>',
          '*://steamcommunity.com/id/*/gcpd/730*tab=majors',
          'http://10.210.57.10/*',
          'file:///*'
        ],
        content_scripts: [
          {
            matches: [
              'https://*.example.com/deep/path*',
              'http://localhost:3000/*',
              'https://example.com:8888/*'
            ]
          }
        ]
      })
    ).toEqual([])
    expect(findInvalidMatchPatterns(undefined)).toEqual([])
  })

  it('does NOT flag WILDCARD ports (verified live: chat-relay installs ENABLED with ws://localhost:*/)', () => {
    // The port is not part of the host and may itself be a wildcard. The check
    // used to test the whole authority, so `localhost:*` read as a mid-host
    // wildcard and warned "the whole extension will not load" about an
    // extension Chrome installs ENABLED with a running service worker
    // (wild: BinaryBeastMaster/chat-relay, verified on Chrome 150).
    expect(
      findInvalidMatchPatterns({
        host_permissions: [
          'ws://localhost:*/',
          'wss://127.0.0.1:*/*',
          'http://example.com:*/*'
        ]
      })
    ).toEqual([])

    // …while a genuine mid-host wildcard is still refused, port or not.
    expect(
      findInvalidMatchPatterns({
        host_permissions: ['*://*carbonwise*:*/*']
      })
    ).toEqual(['*://*carbonwise*:*/*'])
  })

  it('accepts MV3 with no background and tolerates malformed shapes', () => {
    expect(diagnoseChromiumManifestRefusal({manifest_version: 3})).toBeNull()
    expect(
      diagnoseChromiumManifestRefusal({
        manifest_version: 3,
        background: {scripts: []}
      })
    ).toBeNull()
    expect(diagnoseChromiumManifestRefusal(undefined)).toBeNull()
    expect(
      diagnoseChromiumManifestRefusal({manifest_version: 3, background: 'x'})
    ).toBeNull()
  })
})

// Each shape below was proven against a wild subject with CDP
// `Extensions.loadUnpacked`, which reports the reason --load-extension hides.
describe('findChromiumLoadBlockers', () => {
  it('flags a host wildcard Chrome refuses (CarbonWise: *://*carbonwise*/*)', () => {
    expect(
      findInvalidMatchPatterns({
        content_scripts: [
          {matches: ['*://*carbonwise*/*', 'https://*.zomato.com/*']}
        ]
      })
    ).toEqual(['*://*carbonwise*/*'])
  })

  it('keeps legal host wildcards out of the invalid list', () => {
    expect(
      findInvalidMatchPatterns({
        host_permissions: ['*://*/*', 'https://*.example.com/*'],
        content_scripts: [{matches: ['<all_urls>', 'https://stake.com/*/*']}]
      })
    ).toEqual([])
  })

  const valid = {manifest_version: 3, name: 'x', version: '1.0'}

  it('flags more than 4 keyboard shortcuts (spotify-hotkeys ships 12)', () => {
    const commands: Record<string, unknown> = {}
    for (let i = 0; i < 5; i++) {
      commands[`cmd-${i}`] = {suggested_key: {default: `Alt+Shift+${i}`}}
    }
    expect(findChromiumLoadBlockers({...valid, commands})).toEqual([
      'commands: 5 shortcuts declared with "suggested_key" — Chrome allows at most 4.'
    ])
  })

  it('does not flag 4 shortcuts, nor commands without suggested_key', () => {
    const commands: Record<string, unknown> = {
      _execute_action: {description: 'no suggested_key — not a shortcut'}
    }
    for (let i = 0; i < 4; i++) {
      commands[`cmd-${i}`] = {suggested_key: {default: `Alt+Shift+${i}`}}
    }
    expect(findChromiumLoadBlockers({...valid, commands})).toEqual([])
  })

  it('flags a content_scripts group with neither js nor css (fayufox)', () => {
    expect(
      findChromiumLoadBlockers({
        ...valid,
        content_scripts: [
          {matches: ['*://*.mozilla.org/*'], js: [], css: []},
          {matches: ['*://*.example.com/*'], js: ['content.js']}
        ]
      })
    ).toEqual([
      'content_scripts[0]: declares neither "js" nor "css" — Chrome requires at least one.'
    ])
  })

  it('flags a malformed base64 manifest key (queup) but accepts a valid one', () => {
    expect(
      findChromiumLoadBlockers({...valid, key: 'MIIBIjANBgkqhkiG9w0BAQEF'})
    ).toEqual([])
    expect(findChromiumLoadBlockers({...valid, key: 'not-base64!!'})).toEqual([
      'key: not a valid base64 public key — Chrome refuses the extension.'
    ])
    // broken padding — queup's exact failure mode
    expect(
      findChromiumLoadBlockers({...valid, key: 'MIIBIjANBgkqhkiG9w0BAQE'})
    ).toEqual([
      'key: not a valid base64 public key — Chrome refuses the extension.'
    ])
  })

  it('flags missing/empty/non-string name (fixtures 01/02/26, Chrome 150)', () => {
    for (const manifest of [
      {manifest_version: 3, version: '1.0'},
      {manifest_version: 3, name: '', version: '1.0'},
      {manifest_version: 3, name: 42, version: '1.0'}
    ]) {
      const blockers = findChromiumLoadBlockers(manifest)
      expect(blockers.some((b) => b.startsWith('name:')), JSON.stringify(manifest)).toBe(true)
    }
    expect(findChromiumLoadBlockers(valid)).toEqual([])
  })

  it('flags a missing or out-of-grammar version', () => {
    for (const manifest of [
      {manifest_version: 3, name: 'x'},
      {manifest_version: 3, name: 'x', version: 'x.y.z'},
      {manifest_version: 3, name: 'x', version: 1}
    ]) {
      const blockers = findChromiumLoadBlockers(manifest)
      expect(blockers.some((b) => b.startsWith('version:')), JSON.stringify(manifest)).toBe(true)
    }
  })

  it('flags MV3 WAR shape errors but not the MV2 string form (fixtures 06/07/08/23)', () => {
    expect(
      findChromiumLoadBlockers({...valid, web_accessible_resources: ['img.png']})
    ).toEqual([
      'web_accessible_resources[0]: MV2-style entry — MV3 requires {resources, matches|extension_ids|use_dynamic_url} dictionaries.'
    ])
    expect(
      findChromiumLoadBlockers({
        ...valid,
        web_accessible_resources: [{resources: ['img.png']}]
      })
    ).toEqual([
      "web_accessible_resources[0]: needs one of 'matches', 'extension_ids', or 'use_dynamic_url' beside resources — Chrome refuses the extension without it."
    ])
    expect(
      findChromiumLoadBlockers({
        ...valid,
        web_accessible_resources: [{matches: ['https://example.com/*']}]
      })
    ).toEqual([
      "web_accessible_resources[0]: 'resources' is required — Chrome refuses the extension without it."
    ])
    // use_dynamic_url alone satisfies "one other valid key" (verified live)
    expect(
      findChromiumLoadBlockers({
        ...valid,
        web_accessible_resources: [
          {resources: ['img.png'], use_dynamic_url: true}
        ]
      })
    ).toEqual([])
    // MV2 string-array WAR is legal on MV2 — never flag it there
    expect(
      findChromiumLoadBlockers({
        manifest_version: 2,
        name: 'x',
        version: '1.0',
        web_accessible_resources: ['img.png']
      })
    ).toEqual([])
  })

  it('flags content_scripts grammar Chrome refuses (fixtures 09/10/17/18/27)', () => {
    const cs = (group: Record<string, unknown>) =>
      findChromiumLoadBlockers({...valid, content_scripts: [group]})
    expect(cs({js: ['c.js']})).toEqual([
      "content_scripts[0]: 'matches' is required — Chrome refuses the extension without it."
    ])
    expect(cs({matches: [], js: ['c.js']})).toEqual([
      'content_scripts[0].matches: there must be at least one match — Chrome refuses the extension over an empty list.'
    ])
    expect(cs({matches: ['<all_urls>'], js: [42]})).toEqual([
      'content_scripts[0].js[0]: expected a string, got number — Chrome refuses the extension.'
    ])
    expect(
      cs({matches: ['<all_urls>'], js: ['c.js'], run_at: 'document_ready'})
    ).toEqual([
      'content_scripts[0].run_at: expected "document_start", "document_end" or "document_idle", got "document_ready" — Chrome refuses the extension.'
    ])
    expect(cs({matches: ['<all_urls>'], js: ['c.js'], run_at: 3})).toEqual([
      'content_scripts[0].run_at: expected "document_start", "document_end" or "document_idle", got 3 — Chrome refuses the extension.'
    ])
    for (const run_at of ['document_start', 'document_end', 'document_idle']) {
      expect(cs({matches: ['<all_urls>'], js: ['c.js'], run_at})).toEqual([])
    }
  })

  it('flags minimum_chrome_version above the browser or out of grammar (fixtures 11/31/32)', () => {
    expect(
      findChromiumLoadBlockers(
        {...valid, minimum_chrome_version: '999.0'},
        '150.0.7871.24'
      )
    ).toEqual([
      'minimum_chrome_version: requires 999.0 but the resolved browser is 150.0.7871.24 — the browser refuses the extension.'
    ])
    expect(
      findChromiumLoadBlockers({...valid, minimum_chrome_version: 'banana'})
    ).toEqual(['minimum_chrome_version: invalid value "banana" — Chrome refuses the extension.'])
    // below the browser: loads (fixture 31); unknown browser version: silent
    expect(
      findChromiumLoadBlockers(
        {...valid, minimum_chrome_version: '100'},
        '150.0.7871.24'
      )
    ).toEqual([])
    expect(
      findChromiumLoadBlockers({...valid, minimum_chrome_version: '999.0'})
    ).toEqual([])
  })

  it('never flags shapes verified to LOAD on Chrome 150 (the temptation list)', () => {
    // MV3 background.page and background.persistent both install fine.
    expect(
      findChromiumLoadBlockers({...valid, background: {page: 'bg.html'}})
    ).toEqual([])
    expect(
      findChromiumLoadBlockers({
        ...valid,
        background: {service_worker: 'sw.js', persistent: true}
      })
    ).toEqual([])
    expect(
      diagnoseChromiumManifestRefusal({...valid, background: {page: 'bg.html'}})
    ).toBeNull()
  })

  it('tolerates malformed manifests; an empty one is truthfully flagged', () => {
    expect(findChromiumLoadBlockers(undefined)).toEqual([])
    // {} genuinely refuses on Chrome (no name, no version) — say so.
    const empty = findChromiumLoadBlockers({})
    expect(empty.some((b) => b.startsWith('name:'))).toBe(true)
    expect(empty.some((b) => b.startsWith('version:'))).toBe(true)
    const malformed = findChromiumLoadBlockers({
      ...valid,
      commands: 'x',
      content_scripts: 'y',
      web_accessible_resources: 'z'
    })
    expect(malformed).toEqual([])
  })
})

// The locale family — every shape verified live on Chrome 150 (2026-07-13,
// CDP loadUnpacked): missing catalogs, missing default_locale, unparseable
// catalogs, and unresolved __MSG__ variables all refuse the whole extension.
describe('findLocaleLoadBlockers', () => {
  let dir: string
  const valid = {manifest_version: 3, name: 'x', version: '1.0'}

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refusal-locales-'))
  })

  afterEach(() => {
    fs.rmSync(dir, {recursive: true, force: true})
  })

  const writeCatalog = (locale: string, content: string) => {
    const catalogDir = path.join(dir, '_locales', locale)
    fs.mkdirSync(catalogDir, {recursive: true})
    fs.writeFileSync(path.join(catalogDir, 'messages.json'), content)
  }

  it('flags default_locale with no catalog — missing tree or missing locale (fixtures 03/20)', () => {
    expect(
      findLocaleLoadBlockers({...valid, default_locale: 'en'}, dir)
    ).toEqual([
      'default_locale: "en" is declared but _locales/en/messages.json is missing — Chrome refuses the whole extension.'
    ])
    writeCatalog('fr', JSON.stringify({greeting: {message: 'salut'}}))
    expect(
      findLocaleLoadBlockers({...valid, default_locale: 'en'}, dir)
    ).toEqual([
      'default_locale: "en" is declared but _locales/en/messages.json is missing — Chrome refuses the whole extension.'
    ])
  })

  it('flags a populated _locales tree with no default_locale (fixture 04)', () => {
    writeCatalog('en', JSON.stringify({greeting: {message: 'hi'}}))
    expect(findLocaleLoadBlockers(valid, dir)).toEqual([
      '_locales: a locales tree exists but the manifest declares no default_locale — Chrome refuses the whole extension.'
    ])
  })

  it('flags an unparseable default catalog (fixture 22), tolerates an empty one (fixture 21)', () => {
    writeCatalog('en', '{oops')
    expect(
      findLocaleLoadBlockers({...valid, default_locale: 'en'}, dir)
    ).toEqual([
      'default_locale: _locales/en/messages.json is not valid JSON — Chrome refuses the whole extension.'
    ])
    writeCatalog('en', '{}')
    expect(
      findLocaleLoadBlockers({...valid, default_locale: 'en'}, dir)
    ).toEqual([])
  })

  it('flags unresolved __MSG__ variables in name and description (fixtures 05/29)', () => {
    writeCatalog('en', JSON.stringify({other: {message: 'x'}}))
    expect(
      findLocaleLoadBlockers(
        {...valid, name: '__MSG_appName__', default_locale: 'en'},
        dir
      )
    ).toEqual([
      '__MSG_appName__: used in the manifest but not defined in _locales/en/messages.json — Chrome refuses the whole extension.'
    ])
    expect(
      findLocaleLoadBlockers(
        {...valid, description: '__MSG_missing__', default_locale: 'en'},
        dir
      )
    ).toEqual([
      '__MSG_missing__: used in the manifest but not defined in _locales/en/messages.json — Chrome refuses the whole extension.'
    ])
  })

  it('honors the verified tolerances: case-insensitive keys and @@predefined (fixtures 24/25/30)', () => {
    writeCatalog('en', JSON.stringify({appName: {message: 'Cased'}}))
    expect(
      findLocaleLoadBlockers(
        {...valid, name: '__MSG_APPNAME__', default_locale: 'en'},
        dir
      )
    ).toEqual([])
    expect(
      findLocaleLoadBlockers(
        {...valid, name: '__MSG_@@ui_locale__', default_locale: 'en'},
        dir
      )
    ).toEqual([])
    expect(
      findLocaleLoadBlockers(
        {...valid, name: '__MSG_appName__', default_locale: 'en'},
        dir
      )
    ).toEqual([])
  })

  it('stays silent without _locales and without default_locale, and on malformed input', () => {
    expect(findLocaleLoadBlockers(valid, dir)).toEqual([])
    expect(findLocaleLoadBlockers(undefined, dir)).toEqual([])
    expect(findLocaleLoadBlockers({...valid, default_locale: 42}, dir)).toEqual(
      []
    )
  })
})

// "File does not exist: <path>" — storage.managed_schema pointing nowhere
// refuses the whole extension (fixture 19, Chrome 150).
describe('findMissingManagedSchema', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refusal-schema-'))
  })

  afterEach(() => {
    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('flags a missing schema file and accepts a present one', () => {
    const manifest = {storage: {managed_schema: 'schema.json'}}
    expect(findMissingManagedSchema(manifest, dir)).toEqual([
      'storage.managed_schema: "schema.json" does not exist in the extension directory — Chrome refuses the whole extension.'
    ])
    fs.writeFileSync(path.join(dir, 'schema.json'), '{}')
    expect(findMissingManagedSchema(manifest, dir)).toEqual([])
    expect(findMissingManagedSchema({}, dir)).toEqual([])
    expect(findMissingManagedSchema(undefined, dir)).toEqual([])
  })
})

// Chrome refuses the whole extension over an icon it cannot load ("Could not
// load icon '<file>'"), and with --load-extension that surfaces only on
// stderr — dev printed an Extension ID for an extension the browser silently
// never installed (wild: Speak2Type's 0-byte icon-128.png).
describe('findUnloadableIconFiles', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refusal-icons-'))
    fs.mkdirSync(path.join(dir, 'icons'), {recursive: true})
    fs.writeFileSync(path.join(dir, 'icons/empty.png'), '')
    fs.writeFileSync(path.join(dir, 'icons/real.png'), 'png-bytes')
  })

  afterEach(() => {
    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('flags empty and missing icon files across icons and default_icon', () => {
    const findings = findUnloadableIconFiles(
      {
        icons: {'16': 'icons/real.png', '128': 'icons/empty.png'},
        action: {default_icon: 'icons/gone.png'},
        browser_action: {default_icon: {'32': '/icons/empty.png'}}
      },
      dir
    )
    expect(findings).toEqual([
      'icons.128: icon "icons/empty.png" is an empty file (0 bytes) — Chrome refuses the whole extension over an icon it cannot load.',
      'action.default_icon: icon "icons/gone.png" is missing from the extension directory — Chrome refuses the whole extension over an icon it cannot load.',
      'browser_action.default_icon.32: icon "/icons/empty.png" is an empty file (0 bytes) — Chrome refuses the whole extension over an icon it cannot load.'
    ])
  })

  it('stays silent for loadable icons and malformed manifests', () => {
    expect(
      findUnloadableIconFiles({icons: {'16': 'icons/real.png'}}, dir)
    ).toEqual([])
    expect(findUnloadableIconFiles(undefined, dir)).toEqual([])
    expect(
      findUnloadableIconFiles({icons: 'x', action: {default_icon: 42}}, dir)
    ).toEqual([])
    expect(findUnloadableIconFiles({icons: {'16': ''}}, dir)).toEqual([])
  })
})
