import {describe, expect, it} from 'vitest'
import type {Manifest} from '../../../../types'
import {asManifest} from '../../__spec__/helpers/manifest-fakes'
import {buildCanonicalManifestWithOverrides} from '../../manifest-lib/manifest'
import {getManifestOverrides} from '../../manifest-overrides'

// Firefox MV2 reads content_security_policy as one string. The override
// writes the extension_pages slot as that string and both writers drop the
// object form, MV3 output stays as written.
const PAGES = "script-src 'self' 'wasm-unsafe-eval'"
const SANDBOX = "sandbox allow-scripts; script-src 'self'"

const source = {
  name: 'csp',
  version: '1.0.0',
  'chromium:manifest_version': 3,
  'firefox:manifest_version': 2,
  content_security_policy: {extension_pages: PAGES, sandbox: SANDBOX}
}

function unprefixed(manifestVersion: 2 | 3) {
  const {
    'chromium:manifest_version': _mv3,
    'firefox:manifest_version': _mv2,
    ...rest
  } = source

  return {...rest, manifest_version: manifestVersion}
}

describe('MV2 content_security_policy through getManifestOverrides', () => {
  it('writes the extension_pages string and drops the object', () => {
    const result = JSON.parse(
      getManifestOverrides('/p/manifest.json', unprefixed(2) as Manifest)
    )
    expect(result.manifest_version).toBe(2)
    expect(result.content_security_policy).toBe(PAGES)
  })

  it('drops a sandbox-only object outright', () => {
    const result = JSON.parse(
      getManifestOverrides('/p/manifest.json', {
        ...unprefixed(2),
        content_security_policy: {sandbox: SANDBOX}
      } as Manifest)
    )
    expect(result).not.toHaveProperty('content_security_policy')
  })

  it('passes an MV2 string through untouched', () => {
    const result = JSON.parse(
      getManifestOverrides('/p/manifest.json', {
        ...unprefixed(2),
        content_security_policy: PAGES
      } as Manifest)
    )
    expect(result.content_security_policy).toBe(PAGES)
  })

  it('keeps the MV3 object as written', () => {
    const result = JSON.parse(
      getManifestOverrides('/p/manifest.json', unprefixed(3) as Manifest)
    )
    expect(result.content_security_policy).toEqual({
      extension_pages: PAGES,
      sandbox: SANDBOX
    })
  })
})

describe('MV2 content_security_policy through buildCanonicalManifestWithOverrides', () => {
  it('writes the string for firefox once the prefixed manifest_version resolves to 2', () => {
    const result = buildCanonicalManifestWithOverrides(
      '/p/manifest.json',
      asManifest(source),
      'firefox'
    ).manifest as Manifest
    expect(result.manifest_version).toBe(2)
    expect(result.content_security_policy).toBe(PAGES)
  })

  it('drops a sandbox-only object for firefox', () => {
    const result = buildCanonicalManifestWithOverrides(
      '/p/manifest.json',
      asManifest({...source, content_security_policy: {sandbox: SANDBOX}}),
      'firefox'
    ).manifest as Manifest
    expect(result.manifest_version).toBe(2)
    expect(result).not.toHaveProperty('content_security_policy')
  })

  it('keeps the object for chrome where manifest_version resolves to 3', () => {
    const result = buildCanonicalManifestWithOverrides(
      '/p/manifest.json',
      asManifest(source),
      'chrome'
    ).manifest as Manifest
    expect(result.manifest_version).toBe(3)
    expect(result.content_security_policy).toEqual({
      extension_pages: PAGES,
      sandbox: SANDBOX
    })
  })
})
