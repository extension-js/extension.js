import {describe, expect, it} from 'vitest'
import patchBackground from '../apply-dev-defaults-lib/patch-background'
import {patchV2CSP, patchV3CSP} from '../apply-dev-defaults-lib/patch-csp'
import patchExternallyConnectable from '../apply-dev-defaults-lib/patch-externally-connectable'
import {
  DEV_RUNTIME_RESOURCES,
  patchWebResources,
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

  // Safari never starts a service worker, and the injection runs after the
  // Safari manifest patch, so the injected background has to take that shape
  // itself: the same emitted bundle, listed under scripts, no persistent key.
  it('adds the fallback background as scripts for safari', () => {
    expect(
      patchBackground({manifest_version: 3} as any, 'safari').background
    ).toEqual({
      scripts: ['background/service_worker.js']
    })

    expect(
      patchBackground({manifest_version: 3} as any, 'webkit-based').background
    ).toEqual({
      scripts: ['background/service_worker.js']
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

  describe('connect-src loosening follows the connectable host', () => {
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

  describe("a directive that gains a source never keeps 'none'", () => {
    const directiveOf = (policy: string, name: string) =>
      policy
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.split(' ')[0] === name)

    const pagesV3 = (extensionPages: string) =>
      patchV3CSP({
        manifest_version: 3,
        content_security_policy: {extension_pages: extensionPages}
      } as any).extension_pages

    const pagesV2 = (policy: string) =>
      patchV2CSP({manifest_version: 2, content_security_policy: policy} as any)

    const everyDirectiveIsValid = (policy: string) => {
      for (const part of policy.split(';')) {
        const [, ...sources] = part.trim().split(/\s+/)
        if (sources.includes("'none'")) expect(sources).toEqual(["'none'"])
      }
    }

    it("drops 'none' inherited from default-src when it opens connect-src (MV3)", () => {
      const policy = pagesV3(
        "default-src 'none'; script-src 'self'; style-src 'self'"
      )

      expect(directiveOf(policy, 'connect-src')).toBe(
        'connect-src ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:*'
      )

      expect(directiveOf(policy, 'default-src')).toBe("default-src 'none'")
      everyDirectiveIsValid(policy)
    })

    it("drops 'none' written on connect-src itself, in any letter case", () => {
      for (const none of ["'none'", "'NONE'"]) {
        const policy = pagesV3(`script-src 'self'; connect-src ${none}`)

        expect(directiveOf(policy, 'connect-src')).toMatch(
          /^connect-src ws:\/\/127\.0\.0\.1:\*/
        )
      }
    })

    it('keeps what default-src allowed when it writes connect-src', () => {
      const policy = pagesV3("default-src 'self' https://api.example.com")

      expect(directiveOf(policy, 'connect-src')).toMatch(
        /^connect-src 'self' https:\/\/api\.example\.com ws:\/\/127\.0\.0\.1:\*/
      )
    })

    it('leaves connect-src unset when no directive restricts connections', () => {
      expect(pagesV3("script-src 'self'")).not.toContain('connect-src')
    })

    it("leaves scripts and objects to the author's default-src (MV3)", () => {
      const strict = pagesV3("default-src 'none'; style-src 'self'")

      expect(strict).not.toContain('script-src')
      expect(strict).not.toContain('object-src')

      const wasm = pagesV3("default-src 'self' 'wasm-unsafe-eval'")

      expect(wasm).not.toContain('script-src')
      expect(wasm).toContain("default-src 'self' 'wasm-unsafe-eval'")
    })

    it('still covers scripts and objects when the policy names neither and has no default-src (MV3)', () => {
      const policy = pagesV3("style-src 'self'")

      expect(directiveOf(policy, 'script-src')).toBe("script-src 'self'")
      expect(directiveOf(policy, 'object-src')).toBe("object-src 'self'")
    })

    it("drops 'none' from script-src and object-src when MV2 adds its sources", () => {
      const policy = pagesV2("script-src 'none'; object-src 'none'")

      expect(directiveOf(policy, 'script-src')).toBe(
        "script-src 'unsafe-eval' blob: filesystem:"
      )

      expect(directiveOf(policy, 'object-src')).toBe(
        'object-src blob: filesystem:'
      )

      everyDirectiveIsValid(policy)
    })

    it('starts the MV2 script and object copies from default-src', () => {
      const none = pagesV2("default-src 'none'")

      expect(directiveOf(none, 'script-src')).toBe(
        "script-src 'unsafe-eval' blob: filesystem:"
      )

      expect(directiveOf(none, 'object-src')).toBe(
        'object-src blob: filesystem:'
      )

      everyDirectiveIsValid(none)

      const remote = pagesV2("default-src 'self' https://cdn.example.com")

      expect(directiveOf(remote, 'script-src')).toBe(
        "script-src 'self' https://cdn.example.com 'unsafe-eval' blob: filesystem:"
      )
    })

    it('keeps the MV2 defaults when the policy names neither and has no default-src', () => {
      const policy = pagesV2("img-src 'self'")

      expect(directiveOf(policy, 'script-src')).toBe(
        "script-src 'self' 'unsafe-eval' blob: filesystem:"
      )

      expect(directiveOf(policy, 'object-src')).toBe(
        "object-src 'self' blob: filesystem:"
      )
    })

    it('drops upgrade-insecure-requests on Firefox only, where it breaks the loopback dial', () => {
      const manifest = {
        manifest_version: 3,
        content_security_policy: {
          extension_pages:
            "script-src 'self'; upgrade-insecure-requests; connect-src 'self'"
        }
      } as any

      expect(patchV3CSP(manifest, 'firefox').extension_pages).not.toContain(
        'upgrade-insecure-requests'
      )

      expect(patchV3CSP(manifest, 'chrome').extension_pages).toContain(
        '; upgrade-insecure-requests; '
      )

      expect(
        patchV2CSP(
          {
            manifest_version: 2,
            content_security_policy:
              "script-src 'self'; upgrade-insecure-requests"
          } as any,
          'firefox'
        )
      ).not.toContain('upgrade-insecure-requests')
    })

    it('never touches the sandbox slot', () => {
      const sandbox = "sandbox allow-scripts; default-src 'none'"
      const policy = patchV3CSP({
        manifest_version: 3,
        content_security_policy: {
          extension_pages: "default-src 'none'; script-src 'self'",
          sandbox
        }
      } as any)

      expect(policy.sandbox).toBe(sandbox)
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

  it('leaves a declared externally_connectable ids allowlist alone', () => {
    expect(
      patchExternallyConnectable({
        externally_connectable: {
          matches: ['https://example.com/*'],
          ids: ['abcdefghijklmnopabcdefghijklmnop']
        }
      } as any)
    ).toEqual({})

    expect(patchExternallyConnectable({} as any)).toEqual({})
  })

  // The literal list is the dev surface pages can reach. A new entry in the
  // constant widens it, so the edit must show up here on purpose.
  it('exposes exactly the hot bundle and the control file in dev', () => {
    expect(DEV_RUNTIME_RESOURCES).toEqual([
      'hot/*',
      'extension-js-control.json'
    ])
  })

  it('adds only the dev runtime resources while preserving existing entries', () => {
    expect(
      patchWebResourcesV2({
        manifest_version: 2,
        content_scripts: [{matches: ['<all_urls>']}],
        web_accessible_resources: ['existing.js']
      } as any)
    ).toEqual(['existing.js', ...DEV_RUNTIME_RESOURCES])

    expect(
      patchWebResourcesV3({
        manifest_version: 3,
        content_scripts: [{matches: ['https://example.com/*']}],
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
        resources: [...DEV_RUNTIME_RESOURCES],
        matches: ['https://example.com/*']
      }
    ])
  })

  it('never widens the dev manifest past the content script matches', () => {
    const patched = patchWebResourcesV3({
      manifest_version: 3,
      content_scripts: [
        {matches: ['https://example.com/*']},
        {matches: ['https://a.example/*']}
      ]
    } as any) as Array<{resources: string[]; matches: string[]}>

    expect(patched).toHaveLength(1)
    expect(patched[0].matches).toEqual([
      'https://a.example/*',
      'https://example.com/*'
    ])

    expect(patched[0].resources).not.toContain('/*.js')
    expect(patched[0].resources).not.toContain('/*.json')
  })

  it('leaves the key absent when nothing of ours runs in a page', () => {
    expect(patchWebResources({manifest_version: 3} as any)).toEqual({})
  })
})
