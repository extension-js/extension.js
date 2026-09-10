import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {Compilation} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {ApplyDevDefaults} from '../apply-dev-defaults'
import {devInjectedHostPatterns} from '../apply-dev-defaults-lib/dev-injected-hosts'
import {devInjectedPermissions} from '../apply-dev-defaults-lib/dev-injected-permissions'

describe('ApplyDevDefaults', () => {
  it('registers processAssets after REPORT so it runs after WAR patching', () => {
    let capturedStage: number | undefined
    const minimalManifest = {manifest_version: 3, name: 'x'}
    const compilation = {
      errors: [],
      getAsset: (name: string) =>
        name === 'manifest.json'
          ? {source: () => JSON.stringify(minimalManifest)}
          : undefined,
      assets: {
        'manifest.json': {source: () => JSON.stringify(minimalManifest)}
      },
      updateAsset: () => {},
      hooks: {
        processAssets: {
          tap: (opts: {name: string; stage?: number}, fn: () => void) => {
            capturedStage = opts.stage
            fn()
          }
        }
      }
    } as unknown as Compilation

    const compiler = {
      options: {mode: 'development'},
      hooks: {
        thisCompilation: {
          tap: (_name: string, fn: (c: Compilation) => void) => fn(compilation)
        }
      }
    } as any

    new ApplyDevDefaults({
      manifestPath: '/m/manifest.json',
      browser: 'chrome'
    }).apply(compiler)

    expect(capturedStage).toBe(Compilation.PROCESS_ASSETS_STAGE_REPORT + 100)
  })

  it('preserves resolved manifest paths when asset already has them (no overwrite with source paths)', () => {
    const manifestWithResolvedPaths = {
      manifest_version: 3,
      name: 'x',
      version: '1.0.0',
      side_panel: {
        default_path: 'sidebar/index.html',
        default_title: 'Panel'
      },
      background: {
        service_worker: 'background/service_worker.js'
      }
    }

    let updatedManifestJson: string | undefined
    const compilation = {
      errors: [],
      getAsset: (name: string) =>
        name === 'manifest.json'
          ? {source: () => JSON.stringify(manifestWithResolvedPaths)}
          : undefined,
      assets: {
        'manifest.json': {
          source: () => JSON.stringify(manifestWithResolvedPaths)
        }
      },
      updateAsset: (name: string, rawSource: {source: () => string}) => {
        if (name === 'manifest.json') {
          updatedManifestJson = rawSource.source()
        }
      },
      hooks: {
        processAssets: {
          tap: (_opts: unknown, fn: () => void) => fn()
        }
      }
    } as unknown as Compilation

    const compiler = {
      options: {mode: 'development'},
      hooks: {
        thisCompilation: {
          tap: (_name: string, fn: (c: Compilation) => void) => fn(compilation)
        }
      }
    } as any

    new ApplyDevDefaults({
      manifestPath: '/m/manifest.json',
      browser: 'chrome'
    }).apply(compiler)

    expect(updatedManifestJson).toBeDefined()
    const out = JSON.parse(updatedManifestJson!)
    expect(out.side_panel?.default_path).toBe('sidebar/index.html')
    expect(out.background?.service_worker).toBe('background/service_worker.js')
  })

  function runDevDefaults(
    manifest: Record<string, unknown>,
    browser: 'chrome' | 'firefox' = 'chrome',
    modules: Array<{resource: string; layer?: string}> = []
  ) {
    const {out, warnings} = runDevDefaultsWithWarnings(
      manifest,
      browser,
      modules
    )
    void warnings
    return out
  }

  function runDevDefaultsWithWarnings(
    manifest: Record<string, unknown>,
    browser: 'chrome' | 'firefox' = 'chrome',
    modules: Array<{resource: string; layer?: string}> = []
  ) {
    let updated: string | undefined
    const warnings: Array<{name: string; message: string}> = []
    const compilation = {
      errors: [],
      warnings,
      modules,
      getAsset: (name: string) =>
        name === 'manifest.json'
          ? {source: () => JSON.stringify(manifest)}
          : undefined,
      assets: {'manifest.json': {source: () => JSON.stringify(manifest)}},
      updateAsset: (name: string, rawSource: {source: () => string}) => {
        if (name === 'manifest.json') updated = rawSource.source()
      },
      hooks: {processAssets: {tap: (_o: unknown, fn: () => void) => fn()}}
    } as unknown as Compilation
    const compiler = {
      options: {mode: 'development'},
      hooks: {
        thisCompilation: {
          tap: (_n: string, fn: (c: Compilation) => void) => fn(compilation)
        }
      }
    } as any
    new ApplyDevDefaults({
      manifestPath: '/m/manifest.json',
      browser
    }).apply(compiler)
    return {out: JSON.parse(updated!), warnings}
  }

  const SANDBOX =
    "sandbox allow-scripts; script-src 'self' https://cdn.example.com"

  it('keeps the author sandbox policy byte for byte and loosens only the pages slot (MV3)', () => {
    const out = runDevDefaults({
      manifest_version: 3,
      name: 'x',
      content_security_policy: {
        extension_pages:
          "script-src 'self'; object-src 'self'; connect-src 'self' https://api.example.com",
        sandbox: SANDBOX
      }
    })
    expect(out.content_security_policy.sandbox).toBe(SANDBOX)
    expect(out.content_security_policy.extension_pages).toContain(
      'ws://localhost:*'
    )
    expect(out.content_security_policy.extension_pages).toContain(
      'https://api.example.com'
    )
    expect(out.content_security_policy.extension_pages).toContain(
      "script-src 'self'"
    )
  })

  it('keeps the sandbox slot on an MV2 object policy and a plain string on an MV2 string policy (Firefox)', () => {
    const asObject = runDevDefaults(
      {
        manifest_version: 2,
        name: 'x',
        content_security_policy: {
          extension_pages: "script-src 'self'; object-src 'self'",
          sandbox: SANDBOX
        }
      },
      'firefox'
    )
    expect(asObject.content_security_policy.sandbox).toBe(SANDBOX)
    expect(asObject.content_security_policy.extension_pages).toContain(
      "'unsafe-eval'"
    )

    const asString = runDevDefaults(
      {
        manifest_version: 2,
        name: 'x',
        content_security_policy: "script-src 'self'; object-src 'self'"
      },
      'firefox'
    )
    expect(typeof asString.content_security_policy).toBe('string')
    expect(asString.content_security_policy).toContain("'unsafe-eval'")
  })

  it('names an optional permission the dev build turns required', () => {
    const {out, warnings} = runDevDefaultsWithWarnings({
      manifest_version: 3,
      name: 'x',
      optional_permissions: ['tabs']
    })
    expect(out.permissions).toContain('tabs')
    expect(out.optional_permissions).toEqual(['tabs'])
    expect(
      warnings.filter((w) => w.name === 'DevPromotedOptionalPermissionWarning')
    ).toHaveLength(1)
    expect(warnings[0].message).toContain('"tabs"')
  })

  it('names an optional host a content script match promotes', () => {
    const {out, warnings} = runDevDefaultsWithWarnings({
      manifest_version: 3,
      name: 'x',
      optional_host_permissions: ['https://opt.example.com/*'],
      content_scripts: [{matches: ['https://opt.example.com/*'], js: ['c.js']}]
    })
    expect(out.host_permissions).toContain('https://opt.example.com/*')
    expect(out.optional_host_permissions).toEqual(['https://opt.example.com/*'])
    const promoted = warnings.filter(
      (w) => w.name === 'DevPromotedOptionalHostWarning'
    )
    expect(promoted).toHaveLength(1)
    expect(promoted[0].message).toContain('https://opt.example.com/*')
  })

  it('stays quiet when nothing optional is promoted', () => {
    const {warnings} = runDevDefaultsWithWarnings({
      manifest_version: 3,
      name: 'x',
      permissions: ['tabs'],
      optional_permissions: ['bookmarks']
    })
    expect(warnings).toEqual([])
  })

  it('warns when source uses a permission the author only made optional', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dev-defaults-'))
    const file = path.join(dir, 'background.js')
    fs.writeFileSync(file, 'chrome.storage.local.get("k")\n')
    try {
      const {warnings} = runDevDefaultsWithWarnings(
        {manifest_version: 3, name: 'x', optional_permissions: ['storage']},
        'chrome',
        [{resource: file}]
      )
      const drift = warnings.filter(
        (w) => w.name === 'DevInjectedPermissionWarning'
      )
      expect(drift).toHaveLength(1)
      expect(drift[0].message).toContain('optional_permissions')
      expect(drift[0].message).toContain('"storage"')
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  it('warns when source uses chrome.tabs and the manifest never declares it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dev-tabs-'))
    const file = path.join(dir, 'background.js')
    fs.writeFileSync(file, 'chrome.tabs.query({}, (t) => console.log(t))\n')
    try {
      const {out, warnings} = runDevDefaultsWithWarnings(
        {manifest_version: 3, name: 'x'},
        'chrome',
        [{resource: file}]
      )
      expect(out.permissions).toContain('tabs')
      const drift = warnings.filter(
        (w) => w.name === 'DevInjectedPermissionWarning'
      )
      expect(drift).toHaveLength(1)
      expect(drift[0].message).toContain('"tabs"')
      expect(drift[0].message).toContain('background.js')
      expect(drift[0].message).toContain('favIconUrl')
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  it('warns on chrome.tabs for MV2 too', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dev-tabs-mv2-'))
    const file = path.join(dir, 'background.js')
    fs.writeFileSync(file, 'browser.tabs.query({})\n')
    try {
      const {warnings} = runDevDefaultsWithWarnings(
        {manifest_version: 2, name: 'x'},
        'firefox',
        [{resource: file}]
      )
      const drift = warnings.filter(
        (w) => w.name === 'DevInjectedPermissionWarning'
      )
      expect(drift).toHaveLength(1)
      expect(drift[0].message).toContain('"tabs"')
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  // The defect this pins: the warning read a hand-kept copy of the injected
  // list and drifted. This walks the permissions the dev manifest really
  // grants and proves each one still raises the warning.
  describe.each([
    2, 3
  ])('every permission the dev manifest injects warns when used (MV%i)', (manifest_version) => {
    const bare = runDevDefaults({manifest_version, name: 'x'})
    const injected: string[] = bare.permissions

    it('grants only permissions the shared list names', () => {
      expect([...injected].sort()).toEqual(
        [...devInjectedPermissions(manifest_version)].sort()
      )
    })

    it.each(injected)('warns on undeclared chrome.%s use', (api: string) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dev-cover-'))
      const file = path.join(dir, 'background.js')
      fs.writeFileSync(file, `chrome.${api}.someCall()\n`)
      try {
        const {warnings} = runDevDefaultsWithWarnings(
          {manifest_version, name: 'x'},
          manifest_version === 3 ? 'chrome' : 'firefox',
          [{resource: file}]
        )
        const drift = warnings.filter(
          (w) => w.name === 'DevInjectedPermissionWarning'
        )
        expect(drift).toHaveLength(1)
        expect(drift[0].message).toContain(`"${api}"`)
      } finally {
        fs.rmSync(dir, {recursive: true, force: true})
      }
    })
  })

  // Hosts never drifted because the patch and the promotion warning read the
  // same local. That local is now a shared helper, and this keeps every
  // consumer of it honest.
  it('injects exactly the hosts the promotion warning inspects', () => {
    const {out, warnings} = runDevDefaultsWithWarnings({
      manifest_version: 3,
      name: 'x',
      host_permissions: ['https://declared.test/*'],
      optional_host_permissions: ['https://opt.test/*'],
      content_scripts: [
        {matches: ['https://opt.test/*', '<all_urls>'], js: ['c.js']}
      ]
    })
    expect([...out.host_permissions].sort()).toEqual(
      ['<all_urls>', 'https://declared.test/*', 'https://opt.test/*'].sort()
    )
    const promoted = warnings.filter(
      (w) => w.name === 'DevPromotedOptionalHostWarning'
    )
    expect(
      promoted.map((w) => w.message.includes('https://opt.test/*'))
    ).toEqual([true])
  })

  describe('undeclared host access the dev build grants', () => {
    const withSource = (
      contents: string,
      run: (file: string, dir: string) => void
    ) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dev-host-'))
      const file = path.join(dir, 'background.js')
      fs.writeFileSync(file, contents)
      try {
        run(file, dir)
      } finally {
        fs.rmSync(dir, {recursive: true, force: true})
      }
    }

    const hostWarnings = (warnings: Array<{name: string; message: string}>) =>
      warnings.filter((w) => w.name === 'DevInjectedHostWarning')

    it('warns when a background fetch rides on a content-script match (MV3)', () => {
      withSource(
        "fetch('https://api.example.com/v1/ping').then((r) => r.text())\n",
        (file) => {
          const {out, warnings} = runDevDefaultsWithWarnings(
            {
              manifest_version: 3,
              name: 'x',
              content_scripts: [
                {matches: ['https://api.example.com/*'], js: ['c.js']}
              ]
            },
            'chrome',
            [{resource: file}]
          )
          expect(out.host_permissions).toContain('https://api.example.com/*')
          const found = hostWarnings(warnings)
          expect(found).toHaveLength(1)
          expect(found[0].message).toContain('https://api.example.com/v1/ping')
          expect(found[0].message).toContain('background.js')
          expect(found[0].message).toContain('host_permissions')
        }
      )
    })

    // The false positive this guards. A content-script request answers to the
    // page CORS policy, so it works after packaging and must stay silent.
    it('stays silent for the same fetch inside a content script', () => {
      withSource(
        "fetch('https://api.example.com/v1/ping').then((r) => r.text())\n",
        (file) => {
          const {warnings} = runDevDefaultsWithWarnings(
            {
              manifest_version: 3,
              name: 'x',
              content_scripts: [
                {matches: ['https://api.example.com/*'], js: ['c.js']}
              ]
            },
            'chrome',
            [{resource: file, layer: 'extensionjs-content-script'}]
          )
          expect(hostWarnings(warnings)).toEqual([])
        }
      )
    })

    // A shared module reached from both contexts becomes two modules, and only
    // the copy outside the content-script layer needs the host permission.
    // The content-only origin next to it must stay unreported.
    it('warns on the background copy and not on the content-only origin', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dev-host-mix-'))
      const shared = path.join(dir, 'shared.js')
      const contentOnly = path.join(dir, 'content-only.js')
      fs.writeFileSync(
        shared,
        "export const ping = () => fetch('https://api.example.com/v1/ping')\n"
      )
      fs.writeFileSync(
        contentOnly,
        "fetch('https://only.example.com/v1/scrape')\n"
      )
      try {
        const {warnings} = runDevDefaultsWithWarnings(
          {
            manifest_version: 3,
            name: 'x',
            content_scripts: [
              {
                matches: [
                  'https://api.example.com/*',
                  'https://only.example.com/*'
                ],
                js: ['c.js']
              }
            ]
          },
          'chrome',
          [
            {resource: shared, layer: 'extensionjs-content-script'},
            {resource: contentOnly, layer: 'extensionjs-content-script'},
            {resource: shared}
          ]
        )
        const found = hostWarnings(warnings)
        expect(found).toHaveLength(1)
        expect(found[0].message).toContain('https://api.example.com/v1/ping')
        expect(found[0].message).not.toContain('only.example.com')
      } finally {
        fs.rmSync(dir, {recursive: true, force: true})
      }
    })

    it('warns on an XMLHttpRequest open and a new Request too', () => {
      withSource(
        'const xhr = new XMLHttpRequest()\n' +
          "xhr.open('GET', 'https://api.example.com/v1/ping')\n",
        (file) => {
          const {warnings} = runDevDefaultsWithWarnings(
            {
              manifest_version: 3,
              name: 'x',
              content_scripts: [
                {matches: ['https://api.example.com/*'], js: ['c.js']}
              ]
            },
            'chrome',
            [{resource: file}]
          )
          expect(hostWarnings(warnings)).toHaveLength(1)
        }
      )
      withSource(
        "const req = new Request('https://api.example.com/v1/ping')\n",
        (file) => {
          const {warnings} = runDevDefaultsWithWarnings(
            {
              manifest_version: 3,
              name: 'x',
              content_scripts: [
                {matches: ['https://api.example.com/*'], js: ['c.js']}
              ]
            },
            'chrome',
            [{resource: file}]
          )
          expect(hostWarnings(warnings)).toHaveLength(1)
        }
      )
    })

    it('stays silent when the author declared the host themselves', () => {
      withSource("fetch('https://api.example.com/v1/ping')\n", (file) => {
        const {warnings} = runDevDefaultsWithWarnings(
          {
            manifest_version: 3,
            name: 'x',
            host_permissions: ['https://api.example.com/*'],
            content_scripts: [
              {matches: ['https://api.example.com/*'], js: ['c.js']}
            ]
          },
          'chrome',
          [{resource: file}]
        )
        expect(hostWarnings(warnings)).toEqual([])
      })
    })

    // Dev grants no host the content scripts do not name, so a request nobody
    // covers fails in dev too and is not this warning's business.
    it('stays silent for an origin no content script matches', () => {
      withSource("fetch('https://elsewhere.example.org/v1/ping')\n", (file) => {
        const {warnings} = runDevDefaultsWithWarnings(
          {
            manifest_version: 3,
            name: 'x',
            content_scripts: [
              {matches: ['https://api.example.com/*'], js: ['c.js']}
            ]
          },
          'chrome',
          [{resource: file}]
        )
        expect(hostWarnings(warnings)).toEqual([])
      })
    })

    it('stays silent for the dev server on localhost', () => {
      withSource("fetch('http://localhost:8080/hot/update.json')\n", (file) => {
        const {warnings} = runDevDefaultsWithWarnings(
          {
            manifest_version: 3,
            name: 'x',
            content_scripts: [{matches: ['<all_urls>'], js: ['c.js']}]
          },
          'chrome',
          [{resource: file}]
        )
        expect(hostWarnings(warnings)).toEqual([])
      })
    })

    it('warns on MV2, where the injected host lands in permissions', () => {
      withSource(
        "browser.runtime.onInstalled.addListener(() => fetch('https://api.example.com/v1/ping'))\n",
        (file) => {
          const {out, warnings} = runDevDefaultsWithWarnings(
            {
              manifest_version: 2,
              name: 'x',
              content_scripts: [
                {matches: ['https://api.example.com/*'], js: ['c.js']}
              ]
            },
            'firefox',
            [{resource: file}]
          )
          expect(out.permissions).toContain('https://api.example.com/*')
          const found = hostWarnings(warnings)
          expect(found).toHaveLength(1)
          expect(found[0].message).toContain('permissions')
          expect(found[0].message).not.toContain('host_permissions')
        }
      )
    })

    it('names an optional host promotion in the request warning', () => {
      withSource("fetch('https://api.example.com/v1/ping')\n", (file) => {
        const {warnings} = runDevDefaultsWithWarnings(
          {
            manifest_version: 3,
            name: 'x',
            optional_host_permissions: ['https://api.example.com/*'],
            content_scripts: [
              {matches: ['https://api.example.com/*'], js: ['c.js']}
            ]
          },
          'chrome',
          [{resource: file}]
        )
        const found = hostWarnings(warnings)
        expect(found).toHaveLength(1)
        expect(found[0].message).toContain('optional host permissions')
      })
    })

    // The defect this pins: the injected hosts and the warned hosts have to
    // stay one list. This walks the hosts the dev manifest really grants and
    // proves each one raises the warning from a background request.
    it.each([
      ['https://api.example.com/*', 'https://api.example.com/v1/ping'],
      ['*://*.example.net/*', 'https://cdn.example.net/asset.json'],
      ['<all_urls>', 'https://anything.example.org/']
    ])('every host the dev manifest injects warns (%s)', (pattern, url) => {
      const manifest = {
        manifest_version: 3,
        name: 'x',
        content_scripts: [{matches: [pattern], js: ['c.js']}]
      }
      const bare = runDevDefaults(manifest)
      expect(bare.host_permissions).toEqual([
        ...devInjectedHostPatterns(manifest)
      ])

      withSource(`fetch('${url}')\n`, (file) => {
        const {warnings} = runDevDefaultsWithWarnings(manifest, 'chrome', [
          {resource: file}
        ])
        const found = hostWarnings(warnings)
        expect(found).toHaveLength(1)
        expect(found[0].message).toContain(url)
      })
    })
  })

  it('injects scripting + tabs (+ management) in dev for MV3', () => {
    const out = runDevDefaults({manifest_version: 3, name: 'x'})
    expect(out.permissions).toEqual(
      expect.arrayContaining(['scripting', 'tabs', 'management'])
    )
  })

  it('injects the `tabs` permission in dev for MV2 (Firefox), preserving existing permissions', () => {
    const out = runDevDefaults({
      manifest_version: 2,
      name: 'x',
      permissions: ['storage']
    })
    expect(out.permissions).toEqual(expect.arrayContaining(['tabs', 'storage']))
    expect(out.permissions).not.toContain('scripting')
    const deduped = runDevDefaults({
      manifest_version: 2,
      name: 'x',
      permissions: ['tabs']
    })
    expect(
      deduped.permissions.filter((p: string) => p === 'tabs')
    ).toHaveLength(1)
  })

  it('grants host_permissions covering content-script matches in dev (MV3, even when none declared)', () => {
    const out = runDevDefaults({
      manifest_version: 3,
      name: 'x',
      content_scripts: [
        {matches: ['https://a.test/*'], js: ['c.js']},
        {matches: ['https://b.test/*'], js: ['c.js']}
      ]
    })
    expect(out.host_permissions).toEqual(
      expect.arrayContaining(['https://a.test/*', 'https://b.test/*'])
    )
  })

  it('unions injected host_permissions with declared ones (deduped)', () => {
    const out = runDevDefaults({
      manifest_version: 3,
      name: 'x',
      host_permissions: ['https://a.test/*'],
      content_scripts: [
        {matches: ['https://a.test/*', '<all_urls>'], js: ['c.js']}
      ]
    })
    expect(out.host_permissions.sort()).toEqual(
      ['<all_urls>', 'https://a.test/*'].sort()
    )
  })

  it('does NOT add host_permissions when there are no content scripts (MV3)', () => {
    const out = runDevDefaults({manifest_version: 3, name: 'x'})
    expect(out.host_permissions).toBeUndefined()
  })

  it('does NOT inject host_permissions on MV2 (MV2 uses permissions for hosts)', () => {
    const out = runDevDefaults({
      manifest_version: 2,
      name: 'x',
      content_scripts: [{matches: ['https://a.test/*'], js: ['c.js']}]
    })
    expect(out.host_permissions).toBeUndefined()
  })

  it('injects content-script host patterns into MV2 `permissions` (Firefox executeScript host access)', () => {
    const out = runDevDefaults({
      manifest_version: 2,
      name: 'x',
      content_scripts: [
        {matches: ['https://a.test/*'], js: ['c.js']},
        {matches: ['<all_urls>'], js: ['c.js']}
      ]
    })
    expect(out.permissions).toEqual(
      expect.arrayContaining(['tabs', 'https://a.test/*', '<all_urls>'])
    )
  })

  it('patches dev defaults without re-canonicalizing manifest paths', () => {
    const canonicalManifest = {
      manifest_version: 3,
      name: 'x',
      version: '1.0.0',
      side_panel: {
        default_path: 'sidebar/index.html',
        default_title: 'Panel'
      },
      background: {
        service_worker: 'background/service_worker.js'
      },
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['content_scripts/content-0.js']
        }
      ]
    }

    let updatedManifestJson: string | undefined
    const compilation = {
      errors: [],
      getAsset: (name: string) =>
        name === 'manifest.json'
          ? {source: () => JSON.stringify(canonicalManifest)}
          : undefined,
      assets: {
        'manifest.json': {
          source: () => JSON.stringify(canonicalManifest)
        }
      },
      updateAsset: (name: string, rawSource: {source: () => string}) => {
        if (name === 'manifest.json') {
          updatedManifestJson = rawSource.source()
        }
      },
      hooks: {
        processAssets: {
          tap: (_opts: unknown, fn: () => void) => fn()
        }
      }
    } as unknown as Compilation

    const compiler = {
      options: {mode: 'development'},
      hooks: {
        thisCompilation: {
          tap: (_name: string, fn: (c: Compilation) => void) => fn(compilation)
        }
      }
    } as any

    new ApplyDevDefaults({
      manifestPath: '/m/manifest.json',
      browser: 'chrome'
    }).apply(compiler)

    expect(updatedManifestJson).toBeDefined()
    const out = JSON.parse(updatedManifestJson!)
    expect(out.side_panel?.default_path).toBe('sidebar/index.html')
    expect(out.background?.service_worker).toBe('background/service_worker.js')
    expect(out.content_scripts?.[0]?.js).toEqual([
      'content_scripts/content-0.js'
    ])
  })
})
