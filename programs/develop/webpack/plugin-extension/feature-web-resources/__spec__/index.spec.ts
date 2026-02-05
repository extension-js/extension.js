import {Asset, Compilation} from '@rspack/core'
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {WebResourcesPlugin} from '..'
import {resolveUserDeclaredWAR} from '../web-resources-lib/resolve-war'

type Manifest =
  | Partial<chrome.runtime.ManifestV2>
  | Partial<chrome.runtime.ManifestV3>

describe('generateManifestPatches', () => {
  let tmpRoot: string
  let manifestPath: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'war-plugin-'))
    manifestPath = path.join(tmpRoot, 'manifest.json')
    // Ensure manifest root exists
    fs.writeFileSync(manifestPath, '{}')
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, {recursive: true, force: true})
    } catch {
      // ignore
    }
  })

  function runWith(
    entryImports: Record<string, string[]>,
    partialManifest: Manifest = {},
    options?: {
      mode?: 'development' | 'production'
      extraAssets?: Record<string, string>
    }
  ) {
    const manifest = {
      ...partialManifest
    }

    const manifestSource = {
      source: () => JSON.stringify(manifest)
    } as Asset['source']
    const manifestAsset = {
      name: 'manifest.json',
      source: manifestSource
    } as unknown as Readonly<Asset>

    const updateAssetMock = vi.fn()
    const emitAssetMock = vi.fn()

    const plugin = new WebResourcesPlugin({
      manifestPath
    })

    const extraAssets = options?.extraAssets || {}
    plugin['generateManifestPatches'](
      {
        getAsset: () => manifestAsset,
        assets: {
          'manifest.json': manifestSource,
          ...Object.fromEntries(
            Object.entries(extraAssets).map(([name, content]) => [
              name,
              {source: () => String(content)}
            ])
          )
        },
        updateAsset: updateAssetMock,
        emitAsset: emitAssetMock,
        fileDependencies: new Set(),
        options: {mode: options?.mode || 'development'}
      } as unknown as Compilation,
      entryImports
    )

    expect(updateAssetMock).toHaveBeenCalledTimes(1)
    const callArgs = updateAssetMock.mock.calls[0]
    expect(callArgs[0]).toEqual('manifest.json')
    return JSON.parse(callArgs[1].source().toString()) as Manifest
  }

  it('should add non-css/js resources for manifest v3 content scripts', () => {
    expect(
      runWith(
        {
          'content_scripts/content-0': ['content_scripts/content-0.svg'],
          'content_scripts/content-1': ['content_scripts/content-1.json']
        },
        {
          manifest_version: 3,
          content_scripts: [
            {
              matches: ['*://example.com/*'],
              js: ['content_scripts/content-0.js']
            },
            {
              matches: ['*://example.com/logout?e=4'],
              js: ['content_scripts/content-1.js']
            }
          ]
        }
      )
    ).toMatchObject({
      web_accessible_resources: [
        {
          matches: ['*://example.com/*'],
          resources: ['content_scripts/content-0.svg']
        },
        {
          matches: ['*://example.com/logout?e=4'],
          resources: ['content_scripts/content-1.json']
        }
      ]
    })
  })

  it('preserves globs as-is for mv3 user-declared', () => {
    const result = runWith(
      {},
      {
        manifest_version: 3,
        web_accessible_resources: [
          {matches: ['<all_urls>'], resources: ['/*.json', 'assets/*.svg']}
        ]
      }
    )
    const groups = (result as any).web_accessible_resources as {
      matches: string[]
      resources: string[]
    }[]
    expect(groups[0].resources).toEqual(['/*.json', 'assets/*.svg'])
  })

  it('emits production filenames with contenthash for relative files', () => {
    const rel = 'docs/readme.md'
    const abs = path.join(tmpRoot, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, 'hello')

    const updated = runWith(
      {},
      {
        manifest_version: 3,
        web_accessible_resources: [{matches: ['<all_urls>'], resources: [rel]}]
      },
      {mode: 'production'}
    )
    const res = (updated as any).web_accessible_resources?.[0]
      ?.resources?.[0] as string
    expect(res.startsWith('assets/readme.')).toBe(true)
    expect(res.endsWith('.md')).toBe(true)
  })

  it('rewrites user-declared resource to emitted asset path', () => {
    const rel = 'images/icon.png'
    const abs = path.join(tmpRoot, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, 'x')
    const updated = runWith(
      {},
      {
        manifest_version: 3,
        web_accessible_resources: [{matches: ['<all_urls>'], resources: [rel]}]
      }
    )
    const res = (updated as any).web_accessible_resources?.[0]
      ?.resources?.[0] as string
    expect(res).toBe('assets/icon.png')
  })

  it('should not generate web_accessible_resources if content scripts have no imports', () => {
    expect(
      runWith(
        {
          'content_scripts/content-0': [],
          'content_scripts/content-1': []
        },
        {
          manifest_version: 3,
          content_scripts: [
            {
              matches: ['*://example.com/*'],
              js: ['content_scripts/content-0.js']
            },
            {
              matches: ['*://example.com/logout?e=4'],
              js: ['content_scripts/content-1.js']
            }
          ]
        }
      ).web_accessible_resources
    ).toBeUndefined()
  })

  it('should correctly merge existing web_accessible_resources', () => {
    expect(
      runWith(
        {
          'content_scripts/content-0': ['content_scripts/content-0.svg']
        },
        {
          manifest_version: 3,
          content_scripts: [
            {
              matches: ['*://example.com/*'],
              js: ['content_scripts/content-0.js']
            }
          ],
          web_accessible_resources: [
            {
              matches: ['*://example.com/*'],
              resources: ['existing_resource.svg']
            }
          ]
        }
      )
    ).toMatchObject({
      web_accessible_resources: [
        {
          matches: ['*://example.com/*'],
          resources: ['content_scripts/content-0.svg', 'existing_resource.svg']
        }
      ]
    })
  })

  it('adds root-level fonts (e.g. fonts/*) to mv3 WAR when content scripts exist', () => {
    const updated = runWith(
      {},
      {
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['content_scripts/content-0.js']
          }
        ]
      },
      {
        extraAssets: {
          'fonts/DMMonoRegular.woff2': 'x'
        }
      }
    )

    const groups = (updated as any).web_accessible_resources as {
      matches: string[]
      resources: string[]
    }[]
    expect(groups).toBeTruthy()
    expect(groups[0].matches).toEqual(['<all_urls>'])
    expect(groups[0].resources).toContain('fonts/DMMonoRegular.woff2')
  })

  it('should correctly handle manifest v2 content scripts', () => {
    expect(
      runWith(
        {
          'content_scripts/content-0': ['content_scripts/content-0.json']
        },
        {
          manifest_version: 2,
          content_scripts: [
            {
              matches: ['<all_urls>'],
              js: ['content_scripts/content-0.js']
            }
          ]
        }
      )
    ).toMatchObject({
      web_accessible_resources: ['content_scripts/content-0.json']
    })
  })

  it('should exclude .map and .js files from web_accessible_resources', () => {
    expect(
      runWith(
        {
          'content_scripts/content-0': [
            'content_scripts/content-0.js',
            'content_scripts/content-0.css',
            'content_scripts/content-0.js.map',
            'content_scripts/content-0.svg'
          ]
        },
        {
          manifest_version: 3,
          content_scripts: [
            {
              matches: ['*://example.com/*'],
              js: ['content_scripts/content-0.js'],
              css: ['content_scripts/content-0.css']
            }
          ]
        }
      )
    ).toMatchObject({
      web_accessible_resources: [
        {
          matches: ['*://example.com/*'],
          resources: [
            'content_scripts/content-0.css',
            'content_scripts/content-0.svg'
          ]
        }
      ]
    })
  })

  describe('user-declared web_accessible_resources resolution', () => {
    it('ignores malformed mv3 entries without resources', () => {
      const manifest: any = {
        manifest_version: 3,
        web_accessible_resources: [
          {matches: ['<all_urls>']},
          {matches: ['<all_urls>'], resources: ['assets/*.png']}
        ]
      }

      const compilation: any = {
        options: {
          mode: 'development',
          context: tmpRoot,
          output: {path: tmpRoot}
        },
        outputOptions: {path: tmpRoot},
        errors: [],
        warnings: [],
        assets: {},
        getAsset: () => undefined,
        emitAsset: vi.fn(),
        fileDependencies: new Set<string>()
      }

      const resolved = resolveUserDeclaredWAR(
        compilation as Compilation,
        manifestPath,
        manifest,
        'firefox'
      )

      expect(resolved.v3.length).toBe(1)
      expect(Array.from(resolved.v3[0].resources)).toEqual(['assets/*.png'])
    })

    it('errors for invalid mv3 matches pattern (chrome only)', () => {
      const plugin = new WebResourcesPlugin({manifestPath})
      const manifest = {
        manifest_version: 3,
        web_accessible_resources: [
          {matches: ['https://example.com/path'], resources: ['/*.json']}
        ]
      }

      const manifestSource = {source: () => JSON.stringify(manifest)}
      const compilation: any = {
        getAsset: () => ({name: 'manifest.json', source: manifestSource}),
        assets: {'manifest.json': manifestSource},
        updateAsset: vi.fn(),
        emitAsset: vi.fn(),
        fileDependencies: new Set(),
        options: {mode: 'development'},
        errors: [] as any[]
      }

      plugin['generateManifestPatches'](
        compilation as unknown as Compilation,
        {}
      )

      expect(compilation.errors.length).toBe(1)
      const err: any = compilation.errors[0]
      expect(err.name).toBe('WARInvalidMatchPattern')
      expect(err.file).toBe('manifest.json')
    })
    it('resolves relative file to emitted asset (mv3)', () => {
      const rel = 'images/logo.png'
      const abs = path.join(tmpRoot, rel)
      fs.mkdirSync(path.dirname(abs), {recursive: true})
      fs.writeFileSync(abs, 'img')

      const result = runWith(
        {},
        {
          manifest_version: 3,
          web_accessible_resources: [
            {matches: ['<all_urls>'], resources: [rel]}
          ]
        },
        {mode: 'development'}
      )

      const groups = result.web_accessible_resources as {
        matches: string[]
        resources: string[]
      }[]
      expect(groups.length).toBe(1)
      expect(groups[0].resources).toEqual(['assets/logo.png'])
    })

    it('preserves public-root path and warns if missing under public/', () => {
      const pub = '/img/logo.png'
      // Do not create public/img/logo.png to trigger warning and preserve string

      const result = runWith(
        {},
        {
          manifest_version: 3,
          web_accessible_resources: [
            {matches: ['<all_urls>'], resources: [pub]}
          ]
        }
      )

      const groups = (result as any).web_accessible_resources as {
        matches: string[]
        resources: string[]
      }[]
      expect(groups[0].resources).toEqual(['img/logo.png'])
    })

    it('de-dupes between user-declared and auto-collected resources', () => {
      const result = runWith(
        {
          'content_scripts/content-0': ['assets/a.svg']
        },
        {
          manifest_version: 3,
          content_scripts: [
            {
              matches: ['*://example.com/*'],
              js: ['content_scripts/content-0.js']
            }
          ],
          web_accessible_resources: [
            {matches: ['*://example.com/*'], resources: ['assets/a.svg']}
          ]
        }
      )

      const groups = (result as any).web_accessible_resources as {
        matches: string[]
        resources: string[]
      }[]
      expect(groups[0].resources).toEqual(['assets/a.svg'])
    })

    it('de-dupes public-root asset when also auto-collected (mv3)', () => {
      const result = runWith(
        {
          'content_scripts/content-0': ['assets/logo.svg']
        },
        {
          manifest_version: 3,
          content_scripts: [
            {
              matches: ['*://example.com/*'],
              js: ['content_scripts/content-0.js']
            }
          ],
          web_accessible_resources: [
            {matches: ['*://example.com/*'], resources: ['/assets/logo.svg']}
          ]
        }
      )

      const groups = (result as any).web_accessible_resources as {
        matches: string[]
        resources: string[]
      }[]
      expect(groups.length).toBe(1)
      expect(groups[0].resources).toEqual(['assets/logo.svg'])
    })

    it('rewrites mv2 string[] relative file to emitted asset', () => {
      const rel = 'data/file.json'
      const abs = path.join(tmpRoot, rel)
      fs.mkdirSync(path.dirname(abs), {recursive: true})
      fs.writeFileSync(abs, '{"a":1}')

      const result = runWith(
        {},
        {
          manifest_version: 2,
          web_accessible_resources: [rel]
        },
        {mode: 'development'}
      )

      const arr = result.web_accessible_resources
      expect(arr).toEqual(['assets/file.json'])
    })

    it('keeps user-provided mv3 matches intact on firefox', () => {
      const pluginFx = new WebResourcesPlugin({
        manifestPath,
        browser: 'firefox'
      })

      const manifest = {
        manifest_version: 3,
        web_accessible_resources: [
          {matches: ['https://example.com/logout?e=4'], resources: ['/*.json']}
        ]
      }

      const manifestSource = {source: () => JSON.stringify(manifest)}
      const updateAssetMock = vi.fn()
      pluginFx['generateManifestPatches'](
        {
          getAsset: () => ({name: 'manifest.json', source: manifestSource}),
          assets: {'manifest.json': manifestSource},
          updateAsset: updateAssetMock,
          emitAsset: vi.fn(),
          fileDependencies: new Set(),
          options: {mode: 'development'}
        } as unknown as Compilation,
        {}
      )

      const updated = JSON.parse(
        updateAssetMock.mock.calls[0][1].source().toString()
      )
      expect(updated.web_accessible_resources[0].matches).toEqual([
        'https://example.com/logout?e=4'
      ])
    })

    it('emits a warning for missing public-root path', () => {
      const pluginLocal = new WebResourcesPlugin({
        manifestPath
      })

      // public-root points to /root/app/public/img/logo.png which does not exist
      const manifest = {
        manifest_version: 3,
        web_accessible_resources: [
          {matches: ['<all_urls>'], resources: ['/img/logo.png']}
        ]
      }

      // Ensure missing under public/

      const manifestSource = {source: () => JSON.stringify(manifest)}
      const compilation = {
        getAsset: () => ({name: 'manifest.json', source: manifestSource}),
        assets: {'manifest.json': manifestSource},
        updateAsset: vi.fn(),
        emitAsset: vi.fn(),
        fileDependencies: new Set(),
        // Public-root warnings are intentionally emitted in production only to
        // avoid noise in dev mode (dev server will surface runtime 404s).
        options: {mode: 'production'},
        warnings: [] as any[]
      }

      pluginLocal['generateManifestPatches'](
        compilation as unknown as Compilation,
        {}
      )

      expect(compilation.warnings.length).toBeGreaterThan(0)
      const msg = String(
        (compilation.warnings[0] && (compilation.warnings[0] as any).message) ||
          ''
      )
      expect(msg).toContain('NOT FOUND')
      expect((compilation.warnings[0] as any).file).toBe('manifest.json')
    })

    it('emits a warning for missing relative file (mv3) and preserves string', () => {
      const pluginLocal = new WebResourcesPlugin({
        manifestPath
      })

      const rel = 'images/missing.png'
      const manifest = {
        manifest_version: 3,
        web_accessible_resources: [{matches: ['<all_urls>'], resources: [rel]}]
      }

      const manifestSource = {source: () => JSON.stringify(manifest)}
      const compilation = {
        getAsset: () => ({name: 'manifest.json', source: manifestSource}),
        assets: {'manifest.json': manifestSource},
        updateAsset: vi.fn(),
        emitAsset: vi.fn(),
        fileDependencies: new Set(),
        options: {mode: 'development'},
        warnings: [] as any[]
      }

      pluginLocal['generateManifestPatches'](
        compilation as unknown as Compilation,
        {}
      )

      expect(compilation.warnings.length).toBeGreaterThan(0)
      const msg = String(
        (compilation.warnings[0] && compilation.warnings[0].message) || ''
      )
      expect(msg).toContain('NOT FOUND')

      const updated = JSON.parse(
        (compilation.updateAsset as any).mock.calls[0][1].source().toString()
      )
      const war = (updated as any).web_accessible_resources as {
        matches: string[]
        resources: string[]
      }[]
      expect(war[0].resources).toEqual([rel])
    })

    it('adds emitted relative files to fileDependencies', () => {
      const pluginLocal = new WebResourcesPlugin({manifestPath})
      const rel = 'images/logo.png'
      const abs = path.join(tmpRoot, rel)
      fs.mkdirSync(path.dirname(abs), {recursive: true})
      fs.writeFileSync(abs, 'x')

      const manifest = {
        manifest_version: 3,
        web_accessible_resources: [{matches: ['<all_urls>'], resources: [rel]}]
      }
      const manifestSource = {source: () => JSON.stringify(manifest)}
      const compilation: any = {
        getAsset: () => ({name: 'manifest.json', source: manifestSource}),
        assets: {'manifest.json': manifestSource},
        updateAsset: vi.fn(),
        emitAsset: vi.fn(),
        fileDependencies: new Set<string>(),
        options: {mode: 'development'}
      }

      pluginLocal['generateManifestPatches'](compilation as Compilation, {})

      expect(Array.from(compilation.fileDependencies)).toContain(abs)
    })
  })

  it('should merge only when matches sets are equal (mv3) and sort deterministically', () => {
    const result = runWith(
      {
        'content_scripts/content-0': [
          'content_scripts/b.svg',
          'content_scripts/a.svg',
          'content_scripts/a.svg'
        ]
      },
      {
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['https://example.com/*', '*://*.foo.com/*'],
            js: ['content_scripts/content-0.js']
          },
          {
            // different set, overlapping value present but not equal set
            matches: ['https://example.com/*'],
            js: ['content_scripts/other.js']
          }
        ],
        web_accessible_resources: [
          {
            matches: ['*://*.foo.com/*', 'https://example.com/*'],
            resources: ['existing.svg']
          },
          {
            matches: ['https://example.com/*'],
            resources: ['x.svg']
          }
        ]
      }
    )

    const groups = (result as any).web_accessible_resources as {
      matches: string[]
      resources: string[]
    }[]

    // Should produce two groups; one merged with exact-match set, one untouched
    expect(groups.length).toBe(2)

    const merged = groups.find(
      (g) => g.matches.join(',') === '*://*.foo.com/*,https://example.com/*'
    )!
    const untouched = groups.find(
      (g) => g.matches.join(',') === 'https://example.com/*'
    )!

    // Deterministic sort on resources
    expect(merged.resources).toEqual(
      ['content_scripts/a.svg', 'content_scripts/b.svg', 'existing.svg'].sort()
    )
    expect(untouched.resources).toEqual(['x.svg'])
  })
})
