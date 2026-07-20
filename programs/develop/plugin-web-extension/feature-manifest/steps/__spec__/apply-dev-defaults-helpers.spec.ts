import {describe, expect, it} from 'vitest'
import patchBackground from '../apply-dev-defaults-lib/patch-background'
import {patchV2CSP, patchV3CSP} from '../apply-dev-defaults-lib/patch-csp'
import patchExternallyConnectable from '../apply-dev-defaults-lib/patch-externally-connectable'
import {
  patchWebResourcesV2,
  patchWebResourcesV3
} from '../apply-dev-defaults-lib/patch-web-resources'

describe('ApplyDevDefaults patch helpers', () => {
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

  describe('connect-src loosening follows the connectable host (§25)', () => {
    const HOST_ENV = 'EXTENSION_DEV_SERVER_CONNECTABLE_HOST'
    const restrictive = () =>
      ({
        manifest_version: 3,
        content_security_policy: {
          extension_pages: "script-src 'self'; connect-src 'self'"
        }
      }) as any

    const withHost = (host: string | undefined, fn: () => void) => {
      const prev = process.env[HOST_ENV]
      if (host === undefined) delete process.env[HOST_ENV]
      else process.env[HOST_ENV] = host
      try {
        fn()
      } finally {
        if (prev === undefined) delete process.env[HOST_ENV]
        else process.env[HOST_ENV] = prev
      }
    }

    it('loopback-only when no connectable host is exported', () => {
      withHost(undefined, () => {
        const csp = patchV3CSP(restrictive()).extension_pages
        expect(csp).toContain('ws://127.0.0.1:*')
        expect(csp).not.toContain('192.168.')
      })
    })

    it('whitelists a non-loopback connectable host (HMR ws + control bridge dial it)', () => {
      withHost('192.168.0.7', () => {
        const csp = patchV3CSP(restrictive()).extension_pages
        expect(csp).toContain('ws://192.168.0.7:*')
        expect(csp).toContain('http://192.168.0.7:*')
        expect(csp).toContain('ws://127.0.0.1:*')
      })
    })

    it('adds no duplicate entries for a loopback connectable host', () => {
      withHost('127.0.0.1', () => {
        const csp = patchV3CSP(restrictive()).extension_pages
        expect(csp.match(/ws:\/\/127\.0\.0\.1:\*/g)).toHaveLength(1)
      })
    })

    it('brackets IPv6 literals (CSP host-source grammar)', () => {
      withHost('fd00::42', () => {
        const csp = patchV3CSP(restrictive()).extension_pages
        expect(csp).toContain('ws://[fd00::42]:*')
      })
    })

    it('extends default-src fallback with the connectable host too (v2 path)', () => {
      withHost('10.0.0.5', () => {
        const csp = patchV2CSP({
          manifest_version: 2,
          content_security_policy: "default-src 'self'"
        } as any)
        expect(csp).toContain('ws://10.0.0.5:*')
        expect(csp).toMatch(/default-src 'self';/)
      })
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
