import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {Asset, Compilation} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {asCompilation} from '../../__spec__/helpers/rspack-fakes'
import {generateManifestPatches} from '../web-resources-lib/generate-manifest'
import {resolveUserDeclaredWAR} from '../web-resources-lib/resolve-war'

type Manifest =
  | Partial<chrome.runtime.ManifestV2>
  | Partial<chrome.runtime.ManifestV3>

type WarGroup = {matches: string[]; resources: string[]}
type BuildIssue = Error & {file?: string}

// The MV3 shape of web_accessible_resources a patched manifest carries.
function warGroups(manifest: Manifest) {
  return manifest.web_accessible_resources as WarGroup[] | undefined
}

describe('generateManifestPatches', () => {
  let tmpRoot: string
  let manifestPath: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'war-plugin-'))
    manifestPath = path.join(tmpRoot, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  })

  // What the last run warned about, by name and message.
  let lastWarnings: Array<{name?: string; message?: string}> = []

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

    lastWarnings = []

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
    const extraAssetSources = Object.fromEntries(
      Object.entries(extraAssets).map(([name, content]) => [
        name,
        {source: () => String(content)}
      ])
    )
    generateManifestPatches(
      {
        getAsset: (name?: string) => {
          if (!name || name === 'manifest.json') return manifestAsset

          // The shape the bundler hands back: a name and its source.
          return extraAssetSources[name]
            ? {name, source: extraAssetSources[name]}
            : undefined
        },
        assets: {
          'manifest.json': manifestSource,
          ...extraAssetSources
        },
        updateAsset: updateAssetMock,
        emitAsset: emitAssetMock,
        fileDependencies: new Set(),
        errors: [],
        warnings: lastWarnings,
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
          resources: [
            'content_scripts/content-0.svg',
            'content_scripts/content-1.json'
          ]
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

    expect(result.web_accessible_resources).toEqual([
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
    expect(result.web_accessible_resources).toEqual([
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

    expect(result.web_accessible_resources).toEqual([
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

    expect(result.web_accessible_resources).toContain(
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
    const groups = result.web_accessible_resources as {
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
    const res = warGroups(updated)?.[0]?.resources?.[0] as string
    expect(res).toBe('docs/readme.md')
  })

  it('emits user-declared resources at their manifest-relative path', () => {
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
    const res = warGroups(updated)?.[0]?.resources?.[0] as string
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
    const resources = warGroups(updated)?.[0]?.resources as string[]
    expect(resources).toContain('ui/stats.js')
    expect(resources).toContain('storage/stats.js')
  })

  it('exposes root-level wasm and weights the content script pulls, not worker-only models', () => {
    const result = runWith(
      {},
      {
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['https://ocr.example/*'],
            js: ['content_scripts/content-0.js']
          }
        ]
      },
      {
        extraAssets: {
          'content_scripts/content-0.js': [
            'fetch(chrome.runtime.getURL("ocr-core.wasm"))',
            'fetch(chrome.runtime.getURL("ocr-weights.bin"))'
          ].join('\n'),
          'ocr-core.wasm': 'wasm',
          'ocr-weights.bin': 'weights',
          'worker-model.bin': 'secret'
        }
      }
    )

    expect(result.web_accessible_resources).toEqual([
      {
        matches: ['https://ocr.example/*'],
        resources: ['ocr-core.wasm', 'ocr-weights.bin']
      }
    ])
  })

  it('exposes those same content-script payloads on MV2 without the worker model', () => {
    const result = runWith(
      {},
      {
        manifest_version: 2,
        content_scripts: [
          {
            matches: ['https://ocr.example/*'],
            js: ['content_scripts/content-0.js']
          }
        ]
      },
      {
        extraAssets: {
          'content_scripts/content-0.js': [
            'fetch(chrome.runtime.getURL("ocr-core.wasm"))',
            'fetch(chrome.runtime.getURL("ocr-weights.bin"))'
          ].join('\n'),
          'ocr-core.wasm': 'wasm',
          'ocr-weights.bin': 'weights',
          'worker-model.bin': 'secret'
        }
      }
    )

    expect(result.web_accessible_resources).toEqual([
      'ocr-core.wasm',
      'ocr-weights.bin'
    ])
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
    expect(
      (result.background as {service_worker?: string} | undefined)
        ?.service_worker
    ).toBe('background/service_worker.js')

    expect(result.content_scripts?.[0]?.js).toEqual([
      'content_scripts/content-0.js'
    ])

    expect(result.web_accessible_resources).toEqual([
      {
        matches: ['*://example.com/*'],
        resources: ['content_scripts/content-0.svg']
      }
    ])
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
        },
        {extraAssets: {'existing_resource.svg': 'x'}}
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

  it.each([
    2, 3
  ] as const)('leaves a font no injected sheet or content script loads unlisted (mv%i)', (manifestVersion) => {
    const updated = runWith(
      {},
      {
        manifest_version: manifestVersion,
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['content_scripts/content-0.js']
          }
        ]
      },
      {
        extraAssets: {
          'fonts/DMMonoRegular.woff2': 'x',
          'assets/Imported.woff2': 'x'
        }
      }
    )

    expect(updated.web_accessible_resources).toBeUndefined()
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
      const manifest = {
        manifest_version: 3,
        web_accessible_resources: [
          {matches: ['<all_urls>']},
          {matches: ['<all_urls>'], resources: ['assets/*.png']}
        ]
      }

      const compilation = {
        options: {
          mode: 'development',
          context: tmpRoot,
          output: {path: tmpRoot}
        },
        outputOptions: {path: tmpRoot},
        errors: [] as BuildIssue[],
        warnings: [] as BuildIssue[],
        assets: {},
        getAsset: () => undefined,
        emitAsset: vi.fn(),
        fileDependencies: new Set<string>()
      }

      const resolved = resolveUserDeclaredWAR(
        asCompilation(compilation),
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
      const compilation = {
        getAsset: () => ({name: 'manifest.json', source: manifestSource}),
        assets: {'manifest.json': manifestSource},
        updateAsset: vi.fn(),
        emitAsset: vi.fn(),
        fileDependencies: new Set(),
        options: {mode: 'development'},
        errors: [] as BuildIssue[]
      }

      generateManifestPatches(asCompilation(compilation), manifestPath, {})

      expect(compilation.errors.length).toBe(1)
      const err = compilation.errors[0]
      expect(err.name).toBe('WARInvalidMatchPattern')
      expect(err.file).toBe('manifest.json')
    })

    it('accepts mv3 matches with ports and port wildcards Chrome loads (G21)', () => {
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
      const compilation = {
        getAsset: () => ({name: 'manifest.json', source: manifestSource}),
        assets: {'manifest.json': manifestSource},
        updateAsset: vi.fn(),
        emitAsset: vi.fn(),
        fileDependencies: new Set(),
        options: {mode: 'development'},
        errors: [] as BuildIssue[]
      }

      generateManifestPatches(asCompilation(compilation), manifestPath, {})

      expect(compilation.errors.length).toBe(0)
    })

    // The pattern contract encodes Chrome's loader rules. Safari's loader is
    // the converter plus WebKit, so webkit targets are exempt like gecko is.
    it('does not apply the chrome match-pattern contract to webkit targets', () => {
      const manifest = {
        manifest_version: 3,
        web_accessible_resources: [
          {matches: ['https://example.com/path'], resources: ['assets/*.png']}
        ]
      }

      const makeCompilation = () => ({
        options: {
          mode: 'development',
          context: tmpRoot,
          output: {path: tmpRoot}
        },
        outputOptions: {path: tmpRoot},
        errors: [] as BuildIssue[],
        warnings: [] as BuildIssue[],
        assets: {},
        getAsset: () => undefined,
        emitAsset: vi.fn(),
        fileDependencies: new Set<string>()
      })

      for (const browser of ['safari', 'webkit-based']) {
        const compilation = makeCompilation()
        resolveUserDeclaredWAR(
          asCompilation(compilation),
          manifestPath,
          manifest,
          browser
        )

        expect(compilation.errors, browser).toHaveLength(0)
      }

      const chromeCompilation = makeCompilation()
      resolveUserDeclaredWAR(
        asCompilation(chromeCompilation),
        manifestPath,
        manifest,
        'chrome'
      )

      expect(chromeCompilation.errors).toHaveLength(1)
      expect(chromeCompilation.errors[0].name).toBe('WARInvalidMatchPattern')
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
      const compilation = {
        options: {
          mode: 'development',
          context: tmpRoot,
          output: {path: path.join(tmpRoot, 'dist')}
        },
        outputOptions: {path: path.join(tmpRoot, 'dist')},
        errors: [] as BuildIssue[],
        warnings: [] as BuildIssue[],
        assets: {},
        getAsset: (n: string) => (emitted.has(n) ? {name: n} : undefined),
        emitAsset: (n: string, s: unknown) => {
          emitted.add(n)
          emitAsset(n, s)
        },
        fileDependencies: new Set<string>()
      }

      let resolved: ReturnType<typeof resolveUserDeclaredWAR> | undefined
      expect(() => {
        resolved = resolveUserDeclaredWAR(
          asCompilation(compilation),
          manifestPath,
          manifest,
          'chrome'
        )
      }).not.toThrow()

      expect(Array.from(resolved?.v3[0].resources ?? [])).toContain('icons/*')
      const names = emitAsset.mock.calls.map((c) => c[0])
      expect(names).toContain('icons/a.png')
      expect(names).toContain('icons/sub/b.png')
      expect(compilation.errors.length).toBe(0)
    })

    it('lists a public-root path that public/ holds by its output path', () => {
      fs.mkdirSync(path.join(tmpRoot, 'public', 'img'), {recursive: true})
      fs.writeFileSync(path.join(tmpRoot, 'public', 'img', 'logo.png'), 'img')

      const result = runWith(
        {},
        {
          manifest_version: 3,
          web_accessible_resources: [
            {matches: ['<all_urls>'], resources: ['/img/logo.png']}
          ]
        }
      )

      const groups = result.web_accessible_resources as {
        matches: string[]
        resources: string[]
      }[]
      expect(groups[0].resources).toEqual(['img/logo.png'])
    })

    it('leaves out a public-root path public/ lacks, warning in every mode', () => {
      const declared = {
        manifest_version: 3,
        web_accessible_resources: [
          {matches: ['<all_urls>'], resources: ['/img/logo.png']}
        ]
      }

      for (const mode of ['development', 'production']) {
        const compilation = {
          options: {mode, context: tmpRoot, output: {path: tmpRoot}},
          outputOptions: {path: tmpRoot},
          errors: [] as BuildIssue[],
          warnings: [] as BuildIssue[],
          assets: {},
          getAsset: () => undefined,
          emitAsset: vi.fn(),
          fileDependencies: new Set<string>()
        }

        const resolved = resolveUserDeclaredWAR(
          asCompilation(compilation),
          manifestPath,
          declared,
          'chrome'
        )

        expect(resolved.v3, mode).toEqual([])
        expect(compilation.errors, mode).toEqual([])

        expect(compilation.warnings, mode).toHaveLength(1)
        const message = String(compilation.warnings[0].message)
        expect(message).toContain('/img/logo.png')
        expect(message).toContain('public/img/logo.png')
        expect(message).toContain('To reference files in')
        expect(message).not.toContain(tmpRoot)
      }
    })

    it('de-dupes between user-declared and auto-collected resources', () => {
      fs.mkdirSync(path.join(tmpRoot, 'assets'), {recursive: true})
      fs.writeFileSync(path.join(tmpRoot, 'assets', 'a.svg'), '<svg/>')

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

      const groups = result.web_accessible_resources as {
        matches: string[]
        resources: string[]
      }[]
      expect(groups[0].resources).toEqual(['assets/a.svg'])
      expect(lastWarnings.map((w) => [w.name, w.message])).toEqual([])
    })

    it('de-dupes public-root asset when also auto-collected (mv3)', () => {
      fs.mkdirSync(path.join(tmpRoot, 'public', 'assets'), {recursive: true})
      fs.writeFileSync(
        path.join(tmpRoot, 'public', 'assets', 'logo.svg'),
        '<svg/>'
      )

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

      const groups = result.web_accessible_resources as {
        matches: string[]
        resources: string[]
      }[]
      expect(groups.length).toBe(1)
      expect(groups[0].resources).toEqual(['assets/logo.svg'])
      expect(lastWarnings.map((w) => [w.name, w.message])).toEqual([])
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
      const manifest = {
        manifest_version: 3,
        web_accessible_resources: [
          {matches: ['<all_urls>'], resources: ['/img/logo.png']}
        ]
      }

      const manifestSource = {source: () => JSON.stringify(manifest)}
      const compilation = {
        getAsset: () => ({name: 'manifest.json', source: manifestSource}),
        assets: {'manifest.json': manifestSource},
        updateAsset: vi.fn(),
        emitAsset: vi.fn(),
        fileDependencies: new Set(),
        options: {mode: 'production'},
        warnings: [] as BuildIssue[]
      }

      generateManifestPatches(asCompilation(compilation), manifestPath, {})

      expect(compilation.warnings.length).toBeGreaterThan(0)
      const msg = String(compilation.warnings[0]?.message || '')
      expect(msg).toContain('NOT FOUND')
      expect(compilation.warnings[0].file).toBe('manifest.json')
    })

    it('emits a warning for missing relative file (mv3) and drops the entry', () => {
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
        warnings: [] as BuildIssue[]
      }

      generateManifestPatches(asCompilation(compilation), manifestPath, {})

      expect(compilation.warnings.length).toBeGreaterThan(0)
      const msg = String(compilation.warnings[0]?.message || '')
      expect(msg).toContain('NOT FOUND')

      const updated = JSON.parse(
        compilation.updateAsset.mock.calls[0][1].source().toString()
      )

      expect(updated).not.toHaveProperty('web_accessible_resources')
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
      const compilation = {
        getAsset: () => ({name: 'manifest.json', source: manifestSource}),
        assets: {'manifest.json': manifestSource},
        updateAsset: vi.fn(),
        emitAsset: vi.fn(),
        fileDependencies: new Set<string>(),
        options: {mode: 'development'}
      }

      generateManifestPatches(asCompilation(compilation), manifestPath, {})

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
      },
      {extraAssets: {'existing.svg': 'x', 'x.svg': 'x'}}
    )

    const groups = result.web_accessible_resources as {
      matches: string[]
      resources: string[]
    }[]

    expect(groups.length).toBe(2)

    const merged = groups.find(
      (g) => g.matches.join(',') === '*://*.foo.com/*,https://example.com/*'
    )!
    const untouched = groups.find(
      (g) => g.matches.join(',') === 'https://example.com/*'
    )!

    expect(merged.resources).toEqual(
      ['content_scripts/a.svg', 'content_scripts/b.svg', 'existing.svg'].sort()
    )

    expect(untouched.resources).toEqual(['x.svg'])
  })
})
