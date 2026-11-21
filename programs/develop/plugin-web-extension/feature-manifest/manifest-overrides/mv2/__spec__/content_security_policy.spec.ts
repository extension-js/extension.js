import {describe, expect, it} from 'vitest'
import type {Manifest} from '../../../../../types'
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
      } as Manifest)
    ).toEqual({content_security_policy: PAGES})
  })

  it('keeps only the pages slot when a sandbox slot rides along', () => {
    expect(
      contentSecurityPolicy({
        manifest_version: 2,
        content_security_policy: {extension_pages: PAGES, sandbox: SANDBOX}
      } as Manifest)
    ).toEqual({content_security_policy: PAGES})
  })

  it('leaves a string policy to the source spread', () => {
    expect(
      contentSecurityPolicy({
        manifest_version: 2,
        content_security_policy: PAGES
      } as Manifest)
    ).toBeUndefined()
  })

  it('emits nothing for a sandbox-only object', () => {
    expect(
      contentSecurityPolicy({
        manifest_version: 2,
        content_security_policy: {sandbox: SANDBOX}
      } as Manifest)
    ).toBeUndefined()
  })

  it('leaves MV3 alone', () => {
    expect(
      contentSecurityPolicy({
        manifest_version: 3,
        content_security_policy: {extension_pages: PAGES}
      } as Manifest)
    ).toBeUndefined()
  })

  it('returns undefined for MV2 without a policy', () => {
    expect(
      contentSecurityPolicy({manifest_version: 2} as Manifest)
    ).toBeUndefined()
  })
})

describe('hasMv2SandboxPolicy', () => {
  it('flags an MV2 object that carries a sandbox slot', () => {
    expect(
      hasMv2SandboxPolicy({
        manifest_version: 2,
        content_security_policy: {sandbox: SANDBOX}
      } as Manifest)
    ).toBe(true)

    expect(
      hasMv2SandboxPolicy({
        manifest_version: 2,
        content_security_policy: {extension_pages: PAGES, sandbox: SANDBOX}
      } as Manifest)
    ).toBe(true)
  })

  it('stays quiet for a pages-only object, a string, and MV3', () => {
    expect(
      hasMv2SandboxPolicy({
        manifest_version: 2,
        content_security_policy: {extension_pages: PAGES}
      } as Manifest)
    ).toBe(false)

    expect(
      hasMv2SandboxPolicy({
        manifest_version: 2,
        content_security_policy: PAGES
      } as Manifest)
    ).toBe(false)

    expect(
      hasMv2SandboxPolicy({
        manifest_version: 3,
        content_security_policy: {sandbox: SANDBOX}
      } as Manifest)
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
