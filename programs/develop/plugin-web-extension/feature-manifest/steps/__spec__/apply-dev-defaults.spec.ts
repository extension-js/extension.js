import {Compilation} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {ApplyDevDefaults} from '../apply-dev-defaults'

/**
 * Regression: ApplyDevDefaults must run after REPORT-stage manifest patchers
 * (e.g. WAR patch) and after UpdateManifest (SUMMARIZE), so it is the final
 * manifest writer before browser launch.
 *
 * If it runs too early, a later hook can overwrite resolved paths and Chromium
 * may fail with errors like "Side panel file path must exist".
 */
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

  // Under --no-browser the SW re-injects a changed content script into open tabs
  // via chrome.scripting.executeScript, finding them with chrome.tabs.query. Dev
  // defaults inject `scripting`/`tabs` (MV3; `tabs` on MV2) and grant
  // host_permissions covering the content scripts' match patterns so executeScript
  // is allowed on those tabs even when the source declares no host_permissions.
  function runDevDefaults(manifest: Record<string, unknown>) {
    let updated: string | undefined
    const compilation = {
      errors: [],
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
      browser: 'chrome'
    }).apply(compiler)
    return JSON.parse(updated!)
  }

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
    // MV3-only permissions must NOT leak into an MV2 manifest.
    expect(out.permissions).not.toContain('scripting')
    // No duplicates when `tabs` is already declared.
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
    // Confirmed on real Firefox: without this, chrome.scripting.executeScript
    // fails with "Missing host permission for the tab" (MV2 has no
    // host_permissions key, host access lives in `permissions`).
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
