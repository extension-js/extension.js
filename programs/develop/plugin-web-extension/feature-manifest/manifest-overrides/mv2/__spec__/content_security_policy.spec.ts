import {describe, expect, it} from 'vitest'
import {
  contentSecurityPolicy,
  dropMv2ObjectPolicy,
  hasMv2SandboxPolicy
} from '../content_security_policy'

const PAGES = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
const SANDBOX = "sandbox allow-scripts; script-src 'self'"

describe('mv2 content_security_policy override', () => {
  it('turns the object form into the extension_pages string', () => {
    expect(
      contentSecurityPolicy({
        manifest_version: 2,
        content_security_policy: {extension_pages: PAGES}
      } as any)
    ).toEqual({content_security_policy: PAGES})
  })

  it('keeps only the pages slot when a sandbox slot rides along', () => {
    expect(
      contentSecurityPolicy({
        manifest_version: 2,
        content_security_policy: {extension_pages: PAGES, sandbox: SANDBOX}
      } as any)
    ).toEqual({content_security_policy: PAGES})
  })

  it('leaves a string policy to the source spread', () => {
    expect(
      contentSecurityPolicy({
        manifest_version: 2,
        content_security_policy: PAGES
      } as any)
    ).toBeUndefined()
  })

  it('emits nothing for a sandbox-only object', () => {
    expect(
      contentSecurityPolicy({
        manifest_version: 2,
        content_security_policy: {sandbox: SANDBOX}
      } as any)
    ).toBeUndefined()
  })

  it('leaves MV3 alone', () => {
    expect(
      contentSecurityPolicy({
        manifest_version: 3,
        content_security_policy: {extension_pages: PAGES}
      } as any)
    ).toBeUndefined()
  })

  it('returns undefined for MV2 without a policy', () => {
    expect(contentSecurityPolicy({manifest_version: 2} as any)).toBeUndefined()
  })
})

describe('hasMv2SandboxPolicy', () => {
  it('flags an MV2 object that carries a sandbox slot', () => {
    expect(
      hasMv2SandboxPolicy({
        manifest_version: 2,
        content_security_policy: {sandbox: SANDBOX}
      } as any)
    ).toBe(true)

    expect(
      hasMv2SandboxPolicy({
        manifest_version: 2,
        content_security_policy: {extension_pages: PAGES, sandbox: SANDBOX}
      } as any)
    ).toBe(true)
  })

  it('stays quiet for a pages-only object, a string, and MV3', () => {
    expect(
      hasMv2SandboxPolicy({
        manifest_version: 2,
        content_security_policy: {extension_pages: PAGES}
      } as any)
    ).toBe(false)

    expect(
      hasMv2SandboxPolicy({
        manifest_version: 2,
        content_security_policy: PAGES
      } as any)
    ).toBe(false)

    expect(
      hasMv2SandboxPolicy({
        manifest_version: 3,
        content_security_policy: {sandbox: SANDBOX}
      } as any)
    ).toBe(false)
  })
})

describe('dropMv2ObjectPolicy', () => {
  it('removes an object policy that survived the merge on MV2', () => {
    expect(
      dropMv2ObjectPolicy({
        manifest_version: 2,
        name: 'x',
        content_security_policy: {sandbox: SANDBOX}
      })
    ).toEqual({manifest_version: 2, name: 'x'})
  })

  it('keeps an MV2 string policy', () => {
    const manifest = {manifest_version: 2, content_security_policy: PAGES}
    expect(dropMv2ObjectPolicy(manifest)).toBe(manifest)
  })

  it('returns an MV3 manifest unchanged', () => {
    const manifest = {
      manifest_version: 3,
      content_security_policy: {extension_pages: PAGES, sandbox: SANDBOX}
    }
    expect(dropMv2ObjectPolicy(manifest)).toBe(manifest)
  })
})
