import {Asset, Compilation} from '@rspack/core'
import {describe, it, expect, vi} from 'vitest'
import {WebResourcesPlugin} from '..'

type Manifest =
  | Partial<chrome.runtime.ManifestV2>
  | Partial<chrome.runtime.ManifestV3>

describe('generateManifestPatches', () => {
  const plugin = new WebResourcesPlugin({
    manifestPath: 'manifest.json'
  })

  function runWith(
    entryImports: Record<string, string[]>,
    partialManifest: Manifest = {}
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

    const updateAssetMock = vi.fn() as any

    plugin['generateManifestPatches'](
      {
        getAsset: () => manifestAsset,
        assets: {
          'manifest.json': manifestSource
        },
        updateAsset: updateAssetMock
      } as unknown as Compilation,
      entryImports
    )

    expect(updateAssetMock).toHaveBeenCalledTimes(1)
    const callArgs: any = updateAssetMock.mock.calls[0]
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

    const groups = (result as any).web_accessible_resources as Array<{
      matches: string[]
      resources: string[]
    }>

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
