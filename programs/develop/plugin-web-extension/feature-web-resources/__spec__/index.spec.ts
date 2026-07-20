import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {Asset, Compilation} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {generateManifestPatches} from '../web-resources-lib/generate-manifest'
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

    const extraAssets = options?.extraAssets || {}
    generateManifestPatches(
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
      manifestPath,
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

  it('adds canonical emitted content css back to content_scripts.css', () => {
    const result = runWith(
      {
        'content_scripts/content-0': ['content_scripts/content-0.css']
      },
      {
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['content_scripts/content-0.js']
          }
        ]
      }
    )

    expect(result.content_scripts?.[0]?.css).toEqual([
      'content_scripts/content-0.css'
    ])
    expect((result as any).web_accessible_resources).toEqual([
      {
        matches: ['<all_urls>'],
        resources: ['content_scripts/content-0.css']
      }
    ])
  })

  it('keeps url-imported content css out of content_scripts.css', () => {
    const result = runWith(
      {
        'content_scripts/content-0': ['content_scripts/styles.12345678.css']
      },
      {
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['content_scripts/content-0.js']
          }
        ]
      }
    )

    expect(result.content_scripts?.[0]?.css).toBeUndefined()
    expect((result as any).web_accessible_resources).toEqual([
      {
        matches: ['<all_urls>'],
        resources: ['content_scripts/styles.12345678.css']
      }
    ])
  })

  it('adds emitted canonical content css back to content_scripts.css during asset fallback', () => {
    const result = runWith(
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
          'content_scripts/content-0.css': '/* emitted css module output */'
        }
      }
    )

    expect(result.content_scripts?.[0]?.css).toEqual([
      'content_scripts/content-0.css'
    ])
    expect((result as any).web_accessible_resources).toEqual([
      {
        matches: ['<all_urls>'],
        resources: ['content_scripts/content-0.css']
      }
    ])
  })

  it('adds emitted canonical content css back for mv2 asset fallback', () => {
    const result = runWith(
      {},
      {
        manifest_version: 2,
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['content_scripts/content-0.js']
          }
        ]
      },
      {
        extraAssets: {
          'content_scripts/content-0.css': '/* emitted css module output */'
        }
      }
    )

    expect(result.content_scripts?.[0]?.css).toEqual([
      'content_scripts/content-0.css'
    ])
    expect((result as any).web_accessible_resources).toContain(
      'content_scripts/content-0.css'
    )
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

  it('keeps the manifest-relative path in production (getURL addresses it by literal path)', () => {
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
    expect(res).toBe('docs/readme.md')
  })

  it('emits user-declared resources at their manifest-relative path', () => {
    // Runtime code addresses WAR files by their literal path
    // (chrome.runtime.getURL('images/icon.png')); rewriting the manifest to a
    // flattened assets/ name made the declared resource and the requested URL
    // disagree, so Chrome refused to serve the file.
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
    expect(res).toBe('images/icon.png')
  })

  it('same-named files in different directories stay distinct resources (Sappgulf regression)', () => {
    for (const rel of ['ui/stats.js', 'storage/stats.js']) {
      const abs = path.join(tmpRoot, rel)
      fs.mkdirSync(path.dirname(abs), {recursive: true})
      fs.writeFileSync(abs, `// ${rel}`)
    }
    const updated = runWith(
      {},
      {
        manifest_version: 3,
        web_accessible_resources: [
          {
            matches: ['<all_urls>'],
            resources: ['ui/stats.js', 'storage/stats.js']
          }
        ]
      }
    )
    const resources = (updated as any).web_accessible_resources?.[0]
      ?.resources as string[]
    expect(resources).toContain('ui/stats.js')
    expect(resources).toContain('storage/stats.js')
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

  it('preserves canonical script and panel paths while adding WAR patches', () => {
    const result = runWith(
      {
        'content_scripts/content-0': ['content_scripts/content-0.svg']
      },
      {
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
            matches: ['*://example.com/*'],
            js: ['content_scripts/content-0.js']
          }
        ]
      }
    )

    expect(result.side_panel?.default_path).toBe('sidebar/index.html')
    expect((result.background as any)?.service_worker).toBe(
      'background/service_worker.js'
    )
    expect(result.content_scripts?.[0]?.js).toEqual([
      'content_scripts/content-0.js'
    ])
    expect((result as any).web_accessible_resources).toEqual([
      {
        matches: ['*://example.com/*'],
        resources: ['content_scripts/content-0.svg']
      }
    ])
  })

  it('should correctly merge existing web_accessible_resources', () => {
    // User-declared resources must resolve to something real: missing paths
    // are now warned about and dropped instead of shipped broken.
    fs.mkdirSync(path.join(tmpRoot, 'dist'), {recursive: true})
    fs.writeFileSync(path.join(tmpRoot, 'dist', 'existing_resource.svg'), 'x')

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

      generateManifestPatches(
        compilation as unknown as Compilation,
        manifestPath,
        {}
      )

      expect(compilation.errors.length).toBe(1)
      const err: any = compilation.errors[0]
      expect(err.name).toBe('WARInvalidMatchPattern')
      expect(err.file).toBe('manifest.json')
    })

    it('accepts mv3 matches with ports and port wildcards Chrome loads (G21)', () => {
      // Chrome loads WAR matches carrying a port, including the `:*` port
      // wildcard (verified against live Chrome). The build must not fail.
      const manifest = {
        manifest_version: 3,
        web_accessible_resources: [
          {
            matches: [
              '*://localhost:*/*',
              'http://localhost:*/*',
              'http://localhost:3000/*',
              '*://*.example.com:8080/*'
            ],
            resources: ['/*.json']
          }
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

      generateManifestPatches(
        compilation as unknown as Compilation,
        manifestPath,
        {}
      )

      expect(compilation.errors.length).toBe(0)
    })

    it('resolves relative file to its manifest-relative emitted path (mv3)', () => {
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
      expect(groups[0].resources).toEqual(['images/logo.png'])
    })

    it('emits a directory WAR entry as its files + a glob instead of crashing (G15)', () => {
      const iconsDir = path.join(tmpRoot, 'icons')
      fs.mkdirSync(path.join(iconsDir, 'sub'), {recursive: true})
      fs.writeFileSync(path.join(iconsDir, 'a.png'), 'a')
      fs.writeFileSync(path.join(iconsDir, 'sub', 'b.png'), 'b')

      const manifest = {
        manifest_version: 3,
        web_accessible_resources: [
          {matches: ['https://example.com/*'], resources: ['icons/']}
        ]
      }

      const emitAsset = vi.fn()
      const emitted = new Set<string>()
      const compilation: any = {
        options: {
          mode: 'development',
          context: tmpRoot,
          output: {path: path.join(tmpRoot, 'dist')}
        },
        outputOptions: {path: path.join(tmpRoot, 'dist')},
        errors: [],
        warnings: [],
        assets: {},
        getAsset: (n: string) => (emitted.has(n) ? {name: n} : undefined),
        emitAsset: (n: string, s: any) => {
          emitted.add(n)
          emitAsset(n, s)
        },
        fileDependencies: new Set<string>()
      }

      let resolved: any
      expect(() => {
        resolved = resolveUserDeclaredWAR(
          compilation as Compilation,
          manifestPath,
          manifest,
          'chrome'
        )
      }).not.toThrow()

      // Directory declared as a glob so Chrome serves everything beneath it.
      expect(Array.from(resolved.v3[0].resources)).toContain('icons/*')
      // Each file under the directory emitted, preserving its relative path.
      const names = emitAsset.mock.calls.map((c: any[]) => c[0])
      expect(names).toContain('icons/a.png')
      expect(names).toContain('icons/sub/b.png')
      // No spurious errors.
      expect(compilation.errors.length).toBe(0)
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

    it('keeps mv2 string[] relative file at its manifest-relative path', () => {
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
      expect(arr).toEqual(['data/file.json'])
    })

    it('keeps user-provided mv3 matches intact on firefox', () => {
      const manifest = {
        manifest_version: 3,
        web_accessible_resources: [
          {
            matches: ['https://example.com/logout?e=4'],
            resources: ['/*.json']
          }
        ]
      }

      const manifestSource = {source: () => JSON.stringify(manifest)}
      const updateAssetMock = vi.fn()
      generateManifestPatches(
        {
          getAsset: () => ({name: 'manifest.json', source: manifestSource}),
          assets: {'manifest.json': manifestSource},
          updateAsset: updateAssetMock,
          emitAsset: vi.fn(),
          fileDependencies: new Set(),
          options: {mode: 'development'}
        } as unknown as Compilation,
        manifestPath,
        {},
        'firefox'
      )

      const updated = JSON.parse(
        updateAssetMock.mock.calls[0][1].source().toString()
      )
      expect(updated.web_accessible_resources[0].matches).toEqual([
        'https://example.com/logout?e=4'
      ])
    })

    it('emits a warning for missing public-root path', () => {
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

      generateManifestPatches(
        compilation as unknown as Compilation,
        manifestPath,
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

      generateManifestPatches(
        compilation as unknown as Compilation,
        manifestPath,
        {}
      )

      expect(compilation.warnings.length).toBeGreaterThan(0)
      const msg = String(compilation.warnings[0]?.message || '')
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

      generateManifestPatches(compilation as Compilation, manifestPath, {})

      expect(Array.from(compilation.fileDependencies)).toContain(abs)
    })
  })

  it('should merge only when matches sets are equal (mv3) and sort deterministically', () => {
    // See above: declared resources have to exist to stay in the manifest.
    fs.mkdirSync(path.join(tmpRoot, 'dist'), {recursive: true})
    fs.writeFileSync(path.join(tmpRoot, 'dist', 'existing.svg'), 'x')
    fs.writeFileSync(path.join(tmpRoot, 'dist', 'x.svg'), 'x')

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
