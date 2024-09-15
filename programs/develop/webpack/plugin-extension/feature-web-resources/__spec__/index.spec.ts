import { Asset, Compilation } from "webpack";
import { WebResourcesPlugin } from ".."

type Manifest = Partial<chrome.runtime.ManifestV2> | Partial<chrome.runtime.ManifestV3>;

describe('generateManifestPatches', () => {
  const plugin = new WebResourcesPlugin({
    manifestPath: 'manifest.json',
  });

  function runWith(entryImports: Record<string, string[]>, partialManifest: Manifest = {}) {
    const manifest = {
      ...partialManifest,
    };

    const manifestSource = {
      source: () => JSON.stringify(manifest)
    } as Asset['source'];
    const manifestAsset = {
      name: 'manifest.json',
      source: manifestSource,
    } as unknown as Readonly<Asset>;

    const updateAssetMock = jest.fn<void, [string, Asset['source']]>();

    plugin['generateManifestPatches'](
      {
        getAsset: () => manifestAsset,
        assets: {
          'manifest.json': manifestSource,
        },
        updateAsset: updateAssetMock,
      } as unknown as Compilation,
      entryImports
    );

    expect(updateAssetMock).toHaveBeenCalledTimes(1);
    const callArgs = updateAssetMock.mock.calls[0];
    expect(callArgs[0]).toEqual('manifest.json');
    return JSON.parse(callArgs[1].source().toString()) as Manifest;
  }

  it('should work for manifest v2', () => {
    expect(
      runWith({
        'content_scripts/content-0': [
          'content_scripts/content-0.css',
          'content_scripts/content-0.js.map',
        ],
        'content_scripts/content-1': [
          'content_scripts/content-1.css',
          'content_scripts/content-1.js.map',
        ],
      }, {
        manifest_version: 2,
        content_scripts: [
          {
            matches: ['<all_urls>'],
            run_at: 'document_start',
            js: [
              'content_scripts/content-0.js'
            ],
            css: []
          },
          {
            matches: ['<all_urls>'],
            run_at: 'document_start',
            js: [
              'content_scripts/content-1.js'
            ],
            css: []
          }
        ]
      })
    ).toMatchObject({
      web_accessible_resources: [
        'content_scripts/content-0.css',
        'content_scripts/content-0.js.map',
        'content_scripts/content-1.css',
        'content_scripts/content-1.js.map',
      ]
    });
  });

  it('should work for manifest v3', () => {
    expect(
      runWith({
        'content_scripts/content-0': [
          'content_scripts/content-0.css',
          'content_scripts/content-0.js.map',
        ],
        'content_scripts/content-1': [
          'content_scripts/content-1.css',
          'content_scripts/content-1.js.map',
        ],
      }, {
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['<all_urls>'],
            run_at: 'document_start',
            js: [
              'content_scripts/content-0.js'
            ],
            css: []
          },
          {
            matches: ['<all_urls>'],
            run_at: 'document_start',
            js: [
              'content_scripts/content-1.js'
            ],
            css: []
          }
        ]
      })
    ).toMatchObject({
      web_accessible_resources: [
        {
          matches: ['<all_urls>'],
          resources: [
            'content_scripts/content-0.css',
            'content_scripts/content-1.css',
          ],
        }
      ]
    });
  });

  it('should work if there is existing web_accessible_resources', () => {
    expect(
      runWith({
        'content_scripts/content-0': [
          'content_scripts/content-0.css',
          'content_scripts/content-0.js.map',
        ],
        'content_scripts/content-1': [
          'content_scripts/content-1.css',
          'content_scripts/content-1.js.map',
        ],
      }, {
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['<all_urls>'],
            run_at: 'document_start',
            js: [
              'content_scripts/content-0.js'
            ],
            css: []
          },
          {
            matches: ['https://example.com/some/path'],
            run_at: 'document_start',
            js: [
              'content_scripts/content-1.js'
            ],
            css: []
          }
        ],
        web_accessible_resources: [
          {
            matches: ['<all_urls>'],
            resources: [
              'my-file.css',
            ],
          }
        ]
      })
    ).toMatchObject({
      web_accessible_resources: [
        {
          matches: ['<all_urls>'],
          resources: [
            'my-file.css',
            'content_scripts/content-0.css',
          ],
        },
        {
          matches: ['https://example.com/*'],
          resources: [
            'content_scripts/content-1.css',
          ],
        }
      ]
    });
  });

  it('should not add web_accessible_resources if there is no entries', () => {
    expect(
      runWith({}, {
        manifest_version: 3,
        background: {
          service_worker: 'background.js',
        }
      }).web_accessible_resources
    ).toBeUndefined();
  });
});
