import {describe, expect, it} from 'vitest'
import {UpdateManifest} from '../steps/update-manifest'

function runUpdateManifest(opts: {
  mode: 'development' | 'production'
  browser: string
  manifest: any
  warnings?: Error[]
  errors?: Error[]
}) {
  const assets: Record<string, any> = {
    'manifest.json': {source: () => JSON.stringify(opts.manifest)}
  }
  const updated: Record<string, string> = {}
  const compilation: any = {
    errors: opts.errors ?? [],
    warnings: opts.warnings ?? [],
    options: {mode: opts.mode},
    assets,
    getAsset: (n: string) =>
      assets[n] ? {source: assets[n].source} : undefined,
    hooks: {
      processAssets: {tap: (_opts: any, fn: any) => fn()}
    },
    updateAsset: (name: string, src: any) => {
      updated[name] = src.source().toString()
    }
  }
  const compiler: any = {
    options: {mode: opts.mode},
    hooks: {
      thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}
    }
  }

  new UpdateManifest({
    manifestPath: '/m',
    browser: opts.browser
  } as any).apply(compiler)

  return JSON.parse(updated['manifest.json'])
}

describe('UpdateManifest (browser-prefixed background keys)', () => {
  it('keeps a plain key field for chromium builds', () => {
    const out = runUpdateManifest({
      mode: 'production',
      browser: 'chrome',
      manifest: {
        manifest_version: 3,
        name: 'x',
        version: '1.0.0',
        key: 'plain-chromium-key'
      }
    })

    expect(out.key).toBe('plain-chromium-key')
  })

  it('maps chromium:key onto key for chromium builds', () => {
    const out = runUpdateManifest({
      mode: 'production',
      browser: 'chrome',
      manifest: {
        manifest_version: 3,
        name: 'x',
        version: '1.0.0',
        'chromium:key': 'chromium-only-key',
        'firefox:key': 'firefox-only-key'
      }
    })

    expect(out.key).toBe('chromium-only-key')
  })

  it('rewrites firefox: background scripts when using firefox:scripts', () => {
    const out = runUpdateManifest({
      mode: 'production',
      browser: 'firefox',
      manifest: {
        manifest_version: 2,
        name: 'x',
        version: '1.0.0',
        background: {
          'firefox:scripts': ['./src/background/main.ts'],
          'chromium:service_worker': './src/background/main.ts'
        }
      }
    })

    expect(out.background?.scripts).toEqual(['background/scripts.js'])
    expect(out.background?.service_worker).toBeUndefined()
  })

  it('rewrites chromium: background service worker when using chromium:service_worker', () => {
    const out = runUpdateManifest({
      mode: 'production',
      browser: 'chrome',
      manifest: {
        manifest_version: 3,
        name: 'x',
        version: '1.0.0',
        background: {
          'chromium:service_worker': './src/background/main.ts',
          'firefox:scripts': ['./src/background/main.ts']
        }
      }
    })

    expect(out.background?.service_worker).toBe('background/service_worker.js')
    expect(out.background?.scripts).toBeUndefined()
  })

  it('prefers a matching prefixed key over a plain key (prefixed-after-plain)', () => {
    const out = runUpdateManifest({
      mode: 'production',
      browser: 'chrome',
      manifest: {
        manifest_version: 3,
        name: 'x',
        version: '1.0.0',
        key: 'plain-key',
        'chromium:key': 'chromium-only-key'
      }
    })

    expect(out.key).toBe('chromium-only-key')
  })

  it('prefers a matching prefixed key over a plain key (prefixed-before-plain)', () => {
    const out = runUpdateManifest({
      mode: 'production',
      browser: 'chrome',
      manifest: {
        manifest_version: 3,
        name: 'x',
        version: '1.0.0',
        'chromium:key': 'chromium-only-key',
        key: 'plain-key'
      }
    })

    expect(out.key).toBe('chromium-only-key')
  })

  it('drops a non-matching prefixed key and keeps the plain key', () => {
    const out = runUpdateManifest({
      mode: 'production',
      browser: 'chrome',
      manifest: {
        manifest_version: 3,
        name: 'x',
        version: '1.0.0',
        key: 'plain-key',
        'firefox:key': 'firefox-only-key'
      }
    })

    expect(out.key).toBe('plain-key')
  })

  it('resolves MV3 side_panel.default_path to canonical output path', () => {
    const out = runUpdateManifest({
      mode: 'production',
      browser: 'chrome',
      manifest: {
        manifest_version: 3,
        name: 'x',
        version: '1.0.0',
        side_panel: {
          default_path: 'src/sidebar/index.html',
          default_title: 'Panel'
        }
      }
    })

    expect(out.side_panel?.default_path).toBe('sidebar/index.html')
    expect(out.side_panel?.default_title).toBe('Panel')
  })

  for (const browser of ['brave', 'opera', 'vivaldi', 'yandex']) {
    it(`maps chromium: keys onto key for a ${browser} build`, () => {
      const out = runUpdateManifest({
        mode: 'production',
        browser,
        manifest: {
          manifest_version: 3,
          name: 'x',
          version: '1.0.0',
          'chromium:key': 'chromium-only-key',
          'firefox:key': 'firefox-only-key'
        }
      })

      expect(out.key).toBe('chromium-only-key')
    })
  }

  // The Better Lyrics case: a Chrome Web Store key must not ship to Edge Add-ons.
  describe('chrome:key for a store-bound build', () => {
    const manifest = {
      manifest_version: 3,
      name: 'x',
      version: '1.0.0',
      'chrome:key': 'chrome-web-store-key'
    }

    it('keeps the key in the chrome build without a warning', () => {
      const warnings: Error[] = []
      const out = runUpdateManifest({
        mode: 'production',
        browser: 'chrome',
        manifest,
        warnings
      })

      expect(out.key).toBe('chrome-web-store-key')
      expect(warnings).toEqual([])
    })

    for (const browser of ['edge', 'chromium', 'brave']) {
      it(`leaves the key out of the ${browser} build and names the move`, () => {
        const warnings: Error[] = []
        const out = runUpdateManifest({
          mode: 'production',
          browser,
          manifest,
          warnings
        })

        expect(out).not.toHaveProperty('key')
        expect(warnings).toHaveLength(1)
        expect(warnings[0].message).toContain('chrome:key')
        expect(warnings[0].message).toContain('chromium:key')
        expect(warnings[0].message).toContain(browser)
      })
    }

    it('stays quiet on a firefox build, which never read chrome: keys', () => {
      const warnings: Error[] = []
      const out = runUpdateManifest({
        mode: 'production',
        browser: 'firefox',
        manifest: {...manifest, manifest_version: 2},
        warnings
      })

      expect(out).not.toHaveProperty('key')
      // Only the AMO data collection notice fires for this bare manifest.
      expect(
        warnings.filter((warning) => warning.message.includes('chrome:key'))
      ).toEqual([])
    })
  })

  // A manifest_version scoped to chrome: and firefox: leaves an edge build
  // with none at all, which no browser loads.
  describe('manifest_version lost to a vendor prefix', () => {
    const manifest = {
      name: 'x',
      version: '1.0.0',
      'firefox:manifest_version': 2,
      'chrome:manifest_version': 3,
      'chrome:action': {default_title: 't'}
    }

    it('refuses the edge build and names every prefixed key', () => {
      const errors: Error[] = []
      const warnings: Error[] = []
      runUpdateManifest({
        mode: 'production',
        browser: 'edge',
        manifest,
        errors,
        warnings
      })

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('chrome:manifest_version')
      expect(errors[0].message).toContain('firefox:manifest_version')
      expect(errors[0].message).toContain('chromium:manifest_version')
      expect(errors[0].message).toContain('edge')
      // The dropped-key warnings still print next to the refusal.
      expect(
        warnings.filter((warning) =>
          warning.message.includes('chrome:manifest_version')
        )
      ).toHaveLength(1)
    })

    it('refuses a development build the same way', () => {
      const errors: Error[] = []
      runUpdateManifest({
        mode: 'development',
        browser: 'edge',
        manifest,
        errors
      })

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('chrome:manifest_version')
    })

    it('keeps manifest_version 3 for chrome and 2 for firefox', () => {
      const chromeErrors: Error[] = []
      const chrome = runUpdateManifest({
        mode: 'production',
        browser: 'chrome',
        manifest,
        errors: chromeErrors
      })
      const firefoxErrors: Error[] = []
      const firefox = runUpdateManifest({
        mode: 'production',
        browser: 'firefox',
        manifest,
        errors: firefoxErrors
      })

      expect(chromeErrors).toEqual([])
      expect(chrome.manifest_version).toBe(3)
      expect(firefoxErrors).toEqual([])
      expect(firefox.manifest_version).toBe(2)
    })

    it('refuses a resolved manifest_version that is not 2 or 3', () => {
      const errors: Error[] = []
      runUpdateManifest({
        mode: 'production',
        browser: 'chrome',
        manifest: {name: 'x', version: '1.0.0', manifest_version: '3'},
        errors
      })

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('"3"')
      expect(errors[0].message).toContain('only 2 or 3')
    })
  })

  for (const browser of ['waterfox', 'librewolf']) {
    it(`maps firefox: keys onto key for a ${browser} build`, () => {
      const out = runUpdateManifest({
        mode: 'production',
        browser,
        manifest: {
          manifest_version: 3,
          name: 'x',
          version: '1.0.0',
          'chrome:key': 'chromium-only-key',
          'firefox:key': 'firefox-only-key'
        }
      })

      expect(out.key).toBe('firefox-only-key')
    })
  }
})
