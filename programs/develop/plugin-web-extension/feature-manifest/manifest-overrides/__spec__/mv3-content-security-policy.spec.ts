import {describe, expect, it} from 'vitest'
import {buildCanonicalManifest} from '../../manifest-lib/manifest'
import {sanitizeFatalManifestShapes} from '../../manifest-lib/sanitize-fatal-shapes'
import {getManifestOverrides} from '../../manifest-overrides'
import {patchV3CSP} from '../../steps/apply-dev-defaults-lib/patch-csp'
import {hasMv3StringPolicy} from '../common/content_security_policy'

const PAGES = "script-src 'self'; object-src 'self'"
const SANDBOX = "sandbox allow-scripts; script-src 'self'"

describe('hasMv3StringPolicy', () => {
  it('is true only for the MV2 spelling on an MV3 manifest', () => {
    expect(
      hasMv3StringPolicy({
        manifest_version: 3,
        content_security_policy: PAGES
      } as any)
    ).toBe(true)

    expect(
      hasMv3StringPolicy({
        manifest_version: 3,
        content_security_policy: {extension_pages: PAGES}
      } as any)
    ).toBe(false)

    expect(
      hasMv3StringPolicy({
        manifest_version: 2,
        content_security_policy: PAGES
      } as any)
    ).toBe(false)
  })
})

describe('MV3 content_security_policy through getManifestOverrides', () => {
  it('normalizes a string policy into the extension_pages slot', () => {
    const result = JSON.parse(
      getManifestOverrides('/p/manifest.json', {
        name: 'csp',
        version: '1.0.0',
        manifest_version: 3,
        content_security_policy: PAGES
      } as any)
    )
    expect(result.content_security_policy).toEqual({extension_pages: PAGES})
  })

  it('keeps an object policy as written', () => {
    const result = JSON.parse(
      getManifestOverrides('/p/manifest.json', {
        name: 'csp',
        version: '1.0.0',
        manifest_version: 3,
        content_security_policy: {extension_pages: PAGES, sandbox: SANDBOX}
      } as any)
    )
    expect(result.content_security_policy).toEqual({
      extension_pages: PAGES,
      sandbox: SANDBOX
    })
  })

  it('leaves an MV2 string policy a string', () => {
    const result = JSON.parse(
      getManifestOverrides('/p/manifest.json', {
        name: 'csp',
        version: '1.0.0',
        manifest_version: 2,
        content_security_policy: PAGES
      } as any)
    )
    expect(result.content_security_policy).toBe(PAGES)
  })
})

describe('MV3 content_security_policy through buildCanonicalManifest', () => {
  it('writes the object form for chrome', () => {
    const result = buildCanonicalManifest(
      '/p/manifest.json',
      {
        name: 'csp',
        version: '1.0.0',
        manifest_version: 3,
        content_security_policy: PAGES
      } as any,
      'chrome'
    ) as any
    expect(result.content_security_policy).toEqual({extension_pages: PAGES})
  })

  it('lets the unsafe-inline repair reach a string policy', () => {
    const canonical = buildCanonicalManifest(
      '/p/manifest.json',
      {
        name: 'csp',
        version: '1.0.0',
        manifest_version: 3,
        content_security_policy: "script-src 'self' 'unsafe-inline'"
      } as any,
      'chrome'
    )
    const sanitized = sanitizeFatalManifestShapes(canonical, '/p')
    expect(
      (sanitized.manifest as any).content_security_policy.extension_pages
    ).not.toContain('unsafe-inline')

    expect(sanitized.fixes.map((fix) => fix.field)).toContain(
      'content_security_policy.extension_pages'
    )
  })
})

describe('patchV3CSP', () => {
  it('returns the object form even when the author wrote a string', () => {
    const patched = patchV3CSP({
      manifest_version: 3,
      content_security_policy: PAGES
    } as any)
    expect(typeof patched).toBe('object')
    expect(typeof patched.extension_pages).toBe('string')
    expect(patched.extension_pages).toContain("script-src 'self'")
  })
})
