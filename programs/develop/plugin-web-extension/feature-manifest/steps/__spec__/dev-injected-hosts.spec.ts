import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  declaredHostPatterns,
  devInjectedHostPatterns,
  findAbsoluteRequestUrls,
  findInjectedOnlyHostUses,
  isContentScriptModule,
  isHostPattern,
  matchesHostPattern,
  optionalHostPatterns,
  scannableSourcePath
} from '../apply-dev-defaults-lib/dev-injected-hosts'

describe('devInjectedHostPatterns', () => {
  it('unions every content-script match and nothing else', () => {
    expect(
      devInjectedHostPatterns({
        manifest_version: 3,
        host_permissions: ['https://declared.test/*'],
        content_scripts: [
          {matches: ['https://a.test/*', 'https://b.test/*']},
          {matches: ['https://c.test/*']}
        ]
      })
    ).toEqual(['https://a.test/*', 'https://b.test/*', 'https://c.test/*'])
  })

  it('returns nothing when there are no content scripts', () => {
    expect(devInjectedHostPatterns({manifest_version: 3})).toEqual([])
    expect(devInjectedHostPatterns({content_scripts: 'nope'})).toEqual([])
  })

  it('lists a pattern once when a MAIN world bridge entry repeats it', () => {
    expect(
      devInjectedHostPatterns({
        manifest_version: 3,
        content_scripts: [
          {matches: ['https://a.test/*'], world: 'MAIN'},
          {matches: ['https://a.test/*']},
          {matches: ['https://b.test/*', 'https://a.test/*']}
        ]
      })
    ).toEqual(['https://a.test/*', 'https://b.test/*'])
  })
})

describe('isHostPattern', () => {
  it('accepts the schemes a match pattern can carry, sockets included', () => {
    for (const pattern of [
      '<all_urls>',
      '*://*/*',
      'https://a.test/*',
      'http://a.test/*',
      'ws://a.test/*',
      'wss://*.a.test/*',
      'file:///*',
      'ftp://a.test/*'
    ]) {
      expect(isHostPattern(pattern), pattern).toBe(true)
    }
  })

  it('rejects urn and plain API permission names', () => {
    for (const value of ['urn://x', 'tabs', 'storage', 'scripting']) {
      expect(isHostPattern(value), value).toBe(false)
    }
  })
})

describe('scannableSourcePath', () => {
  it('reads every script extension, .mts and .cts included', () => {
    for (const ext of ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts']) {
      expect(scannableSourcePath(`/p/src/a.${ext}`), ext).toBe(
        `/p/src/a.${ext}`
      )
    }
  })

  it('drops a request query before the extension test and the read', () => {
    expect(scannableSourcePath('/p/src/a.ts?used')).toBe('/p/src/a.ts')
    expect(scannableSourcePath('/p/App.vue?vue&type=script&lang.ts')).toBe(
      '/p/App.vue'
    )
    expect(scannableSourcePath('/p/App.svelte')).toBe('/p/App.svelte')
  })

  it('skips dependencies, data files and empty resources', () => {
    expect(scannableSourcePath('/p/node_modules/x/a.js')).toBeUndefined()
    expect(scannableSourcePath('/p/data.json')).toBeUndefined()
    expect(scannableSourcePath('/p/style.css?x.ts')).toBeUndefined()
    expect(scannableSourcePath(undefined)).toBeUndefined()
  })
})

describe('findInjectedOnlyHostUses', () => {
  it('scans .mts, .cts and a resource that carries a query', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-host-scan-'))
    const worker = path.join(dir, 'worker.mts')
    const legacy = path.join(dir, 'legacy.cts')
    fs.writeFileSync(worker, "fetch('https://api.one.test/v1')\n")
    fs.writeFileSync(legacy, "fetch('https://api.two.test/v1')\n")
    const uses = findInjectedOnlyHostUses(
      [{resource: worker}, {resource: `${legacy}?used`}],
      ['https://api.one.test/*', 'https://api.two.test/*'],
      [],
      []
    )
    expect(uses.map((use) => use.file).sort()).toEqual([legacy, worker].sort())
    fs.rmSync(dir, {recursive: true, force: true})
  })
})

describe('declaredHostPatterns', () => {
  it('reads host_permissions on MV3', () => {
    expect(
      declaredHostPatterns({
        manifest_version: 3,
        host_permissions: ['https://a.test/*'],
        permissions: ['tabs']
      })
    ).toEqual(['https://a.test/*'])
  })

  it('separates hosts from API permissions on MV2', () => {
    expect(
      declaredHostPatterns({
        manifest_version: 2,
        permissions: ['tabs', 'https://a.test/*', '<all_urls>', 'storage']
      })
    ).toEqual(['https://a.test/*', '<all_urls>'])
  })
})

describe('optionalHostPatterns', () => {
  it('reads optional_host_permissions on MV3 and optional_permissions on MV2', () => {
    expect(
      optionalHostPatterns({
        manifest_version: 3,
        optional_host_permissions: ['https://a.test/*']
      })
    ).toEqual(['https://a.test/*'])
    expect(
      optionalHostPatterns({
        manifest_version: 2,
        optional_permissions: ['bookmarks', 'https://a.test/*']
      })
    ).toEqual(['https://a.test/*'])
  })
})

describe('matchesHostPattern', () => {
  it.each([
    ['<all_urls>', 'https://anything.test/x', true],
    ['https://api.test/*', 'https://api.test/v1/ping', true],
    ['https://api.test/*', 'http://api.test/v1/ping', false],
    ['https://api.test/*', 'https://other.test/v1/ping', false],
    ['*://api.test/*', 'http://api.test/v1', true],
    ['*://api.test/*', 'ftp://api.test/v1', false],
    ['*://*.test/*', 'https://deep.sub.test/a', true],
    ['*://*.api.test/*', 'https://api.test/a', true],
    ['*://*.api.test/*', 'https://notapi.test/a', false],
    ['https://api.test/v1/*', 'https://api.test/v2/ping', false],
    ['https://api.test/v1/*', 'https://api.test/v1/ping', true],
    ['https://*/*', 'https://api.test/v1', true],
    ['not a pattern', 'https://api.test/', false]
  ])('%s vs %s', (pattern, url, expected) => {
    expect(matchesHostPattern(pattern, url)).toBe(expected)
  })
})

describe('findAbsoluteRequestUrls', () => {
  it('finds fetch, Request and XMLHttpRequest open targets', () => {
    const source = [
      "await fetch('https://one.test/a')",
      'const r = new Request("https://two.test/b")',
      'const xhr = new XMLHttpRequest()',
      "xhr.open('POST', `https://three.test/c`)"
    ].join('\n')
    expect(findAbsoluteRequestUrls(source).sort()).toEqual([
      'https://one.test/a',
      'https://three.test/c',
      'https://two.test/b'
    ])
  })

  it('ignores an open call in a file that never names XMLHttpRequest', () => {
    expect(
      findAbsoluteRequestUrls("db.open('GET', 'https://one.test/a')")
    ).toEqual([])
  })

  it('ignores relative fetches and the loopback dev server', () => {
    const source = [
      "fetch('/api/local')",
      "fetch('http://localhost:8080/hot/update.json')",
      "fetch('http://127.0.0.1:8080/hot/update.json')"
    ].join('\n')
    expect(findAbsoluteRequestUrls(source)).toEqual([])
  })
})

describe('isContentScriptModule', () => {
  it('reads the layer the content-script entries carry', () => {
    expect(isContentScriptModule({layer: 'extensionjs-content-script'})).toBe(
      true
    )
    expect(isContentScriptModule({})).toBe(false)
    expect(isContentScriptModule({layer: null})).toBe(false)
  })
})
