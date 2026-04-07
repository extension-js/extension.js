import {describe, expect, it} from 'vitest'
import patchBackground from '../steps/setup-reload-strategy/apply-manifest-dev-defaults/patch-background'
import patchExternallyConnectable from '../steps/setup-reload-strategy/apply-manifest-dev-defaults/patch-externally-connectable'
import {
  patchV2CSP,
  patchV3CSP
} from '../steps/setup-reload-strategy/apply-manifest-dev-defaults/patch-csp'
import {
  patchWebResourcesV2,
  patchWebResourcesV3
} from '../steps/setup-reload-strategy/apply-manifest-dev-defaults/patch-web-resources'

describe('ApplyManifestDevDefaults patch helpers', () => {
  it('adds a fallback background script for firefox and mv3 chromium', () => {
    expect(
      patchBackground({manifest_version: 3} as any, 'firefox').background
    ).toEqual({
      scripts: ['background/script.js']
    })

    expect(
      patchBackground({manifest_version: 3} as any, 'chromium').background
    ).toEqual({
      service_worker: 'background/service_worker.js'
    })
  })

  it('preserves existing background declarations', () => {
    expect(
      patchBackground(
        {
          manifest_version: 3,
          background: {
            service_worker: 'worker.js'
          }
        } as any,
        'chromium'
      )
    ).toEqual({
      background: {
        service_worker: 'worker.js'
      }
    })
  })

  it('ensures v2 and v3 CSP defaults are present', () => {
    expect(patchV2CSP({manifest_version: 2} as any)).toContain("'unsafe-eval'")
    expect(patchV2CSP({manifest_version: 2} as any)).toContain('object-src')

    expect(patchV3CSP({manifest_version: 3} as any)).toEqual({
      extension_pages: "script-src 'self'; object-src 'self'; "
    })
  })

  it('adds extension ids to externally_connectable when missing', () => {
    expect(
      patchExternallyConnectable({
        externally_connectable: {
          matches: ['https://example.com/*']
        }
      } as any)
    ).toEqual({
      externally_connectable: {
        matches: ['https://example.com/*'],
        ids: ['*']
      }
    })
  })

  it('adds dev web-accessible defaults while preserving existing entries', () => {
    expect(
      patchWebResourcesV2({
        web_accessible_resources: ['existing.js']
      } as any)
    ).toEqual(
      expect.arrayContaining([
        'existing.js',
        '/scripts/*.js',
        '/*.css',
        '/hot/*'
      ])
    )

    expect(
      patchWebResourcesV3({
        web_accessible_resources: [
          {
            resources: ['existing.js'],
            matches: ['https://example.com/*']
          }
        ]
      } as any)
    ).toEqual([
      {
        resources: ['existing.js'],
        matches: ['https://example.com/*']
      },
      {
        resources: expect.arrayContaining([
          '/scripts/*.js',
          '/*.css',
          '/hot/*'
        ]),
        matches: ['<all_urls>']
      }
    ])
  })
})
