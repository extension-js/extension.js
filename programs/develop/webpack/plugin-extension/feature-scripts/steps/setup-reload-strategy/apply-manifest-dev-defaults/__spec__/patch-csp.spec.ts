import {describe, it, expect} from 'vitest'
import {patchV2CSP, patchV3CSP} from '../patch-csp'

const makeManifest = (content_security_policy?: any) =>
  ({content_security_policy}) as any

describe('patchV2CSP', () => {
  it('falls back to defaults when missing', () => {
    const policy = patchV2CSP(makeManifest())
    expect(policy).toContain("script-src 'self'")
    expect(policy).toContain("'unsafe-eval'")
    expect(policy).toContain('blob:')
    expect(policy).toContain('filesystem:')
    expect(policy).toContain("object-src 'self'")
  })

  it('handles MV3-style objects without throwing', () => {
    const policy = patchV2CSP(
      makeManifest({
        extension_pages: "script-src 'self'"
      })
    )
    expect(policy).toContain("script-src 'self'")
    expect(policy).toContain("'unsafe-eval'")
  })
})

describe('patchV3CSP', () => {
  it('returns extension_pages defaults when missing', () => {
    const policy = patchV3CSP(makeManifest())
    expect(policy.extension_pages).toContain("script-src 'self'")
    expect(policy.extension_pages).toContain("object-src 'self'")
  })
})
